# AgileCampus 图七设计：飞书（Lark）接入——绑定 + 私信提醒

日期：2026-07-23
状态：**已定案（brainstorming 通过，待 writing-plans 展开）**
承接：图五纲要遗留的 **E 接入飞书**；图六·C（时间线甘特）已并入 master。
并入：技术债「批量落库非事务」（`commitDraft` 事务化）随本役一并清偿。

---

## 0. 背景与目标

飞书接入之价值内核在**通知**——让 AgileCampus 的任务动态经飞书私信直达成员，无需常驻网页。绑定（OAuth）为手段，提醒为目的。

**四类提醒**（陛下已定）：
1. 任务临期（明日到期未完成）——定时
2. 任务逾期（已过截止日未 done）——定时
3. 被指派新任务——即时
4. 任务完成通知——即时，发给**任务创建者**（操作者本人则跳过）

**前提**：飞书自建应用凭证已备（`.env` 中 `FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_REDIRECT_URI`/`FEISHU_BASE_URL`/`CRON_SECRET` 皆已填），**真机演武**——走真实 OAuth 回调 + 真实私信验收。

---

## 1. 关键决策记录

| 决策项 | 定论 | 理由 |
|---|---|---|
| 凭证 | 已备，真机演武 | OAuth 与发私信皆真实端到端验证 |
| 绑定方式 | 飞书 OAuth 网页授权 | schema/env 既定；回调存 `open_id` 一对一绑定 |
| 提醒渠道 | 应用私信（按 `open_id`） | 直达个人，无需建群 |
| 提醒场景 | 临期 + 逾期 + 被指派 + 完成 | 陛下四选全收 |
| 完成通知收件人 | 任务创建者（≠操作者时） | 派活者关心活干完没 |
| 定时承载 | 外部调度打 `/api/cron/reminders` | 解耦、可重跑、多实例安全、serverless 友好、契合 NAS 部署 |
| 未绑定用户 | 静默跳过（无 `open_id` 不发） | 绑定为自愿，缺则无通知 |
| 通知失败 | fire-and-forget，仅记日志 | 通知乃副作用，绝不阻断主业务落库 |

---

## 2. 数据模型变更

**`users`（飞书三字段，已在工作区加，待 `db:push`）**
```
feishu_open_id  text unique   -- 应用内用户唯一标识，发私信用
feishu_name     text          -- 飞书显示名，绑定 UI 展示
feishu_bound_at timestamp     -- 绑定时刻
```

**`tasks`（新增创建者字段）**
```
created_by_id  uuid references users(id) on delete set null  -- 可空
```
- 仿现成的 `conversations.created_by_id`。
- **可空**：历史任务无创建者 → 完成时无人可通知，静默跳过。
- `createTask` 落库须写入 `createdById = actorId`。

两处变更经 `npm run db:push`（本项目用 push 非 migrate）推送至 dev 与 test 两库。

---

## 3. 模块设计（各单元职责单一、可独立测试）

### 3.1 `src/lib/feishu.ts`——飞书斥候（纯 API 封装）
对外只暴露三个纯函数，内部封装 fetch 与鉴权，**mock fetch 即可离线测**：

- `getTenantAccessToken(): Promise<string>`——POST `tenant_access_token/internal`（app_id + secret）换取；**内存缓存**至临期前（token 约 2h 有效，留安全余量），并发去重。
- `exchangeOAuthCode(code): Promise<{ openId: string; name: string }>`——据飞书开放平台《获取登录用户信息》流程：code → user_access_token → 用户信息（`open_id` + `name`）。确切端点在 plan 阶段据飞书文档核定。
- `sendTextMessage(openId, text): Promise<void>`——POST `im/v1/messages`（`receive_id_type=open_id`），带 tenant_token。失败抛错（由 notify 层 catch）。

所有请求 base 取 `FEISHU_BASE_URL`。缺凭证时（env 空）函数快速失败并记日志——供无凭证环境降级。

### 3.2 OAuth 绑定
- **`GET /api/auth/feishu/login`**——`await auth()` 取当前登录用户（未登录 → 重定向 `/login`）；生成随机 `state`（存 cookie，防 CSRF）；重定向至飞书授权页（`app_id` + `redirect_uri` + `state`）。
- **`GET /api/auth/feishu/callback`**——校验 `state` 与 cookie 一致（不符 → 拒）；`await auth()` 取当前用户；`exchangeOAuthCode(code)` → `bindFeishu(userId, { openId, name })`；重定向回 `/settings`（带成功/失败提示 query）。
- **绑定业务**并入 `src/lib/user.ts`：
  - `bindFeishu(userId, { openId, name })`——写 `feishuOpenId/feishuName/feishuBoundAt`；`open_id` 唯一键冲突（一个飞书号绑两个 AgileCampus 账号）→ 转译为友好 `AppError`。
  - `unbindFeishu(userId)`——清空三字段。

### 3.3 绑定 UI：`/settings`
新建设置页（与 `/settings/tokens` 平级）。飞书绑定卡片，沿用「学术工作台」设计系统（`.ac-card`/`.ac-btn`）：
- 未绑：显「绑定飞书」按钮 → `GET /api/auth/feishu/login`
- 已绑：显飞书名 + 绑定时间 + 「解绑」按钮（server action → `unbindFeishu`）
- 回调带回的成功/失败提示在页面顶部横幅展示。

### 3.4 `src/lib/notify.ts`——通知业务（组文案 + 调斥候，fire-and-forget）
每函数内部：查收件人 `open_id`（无则跳过）→ 组文案 → `sendTextMessage` → **catch 仅 `console.error`，绝不抛出**。

- `notifyTaskAssigned(task)`——私信 `assigneeId` 之人：「【新任务】你被指派：{title}（截止 {dueDate|无}）」
- `notifyTaskCompleted(task, actorId)`——查 `createdById`；若存在且 ≠ `actorId`，私信之：「【已完成】你创建的任务「{title}」已完成」
- `scanAndNotifyDue()`——扫全库：
  - 临期 = `status ≠ done` 且 `dueDate = 明日`
  - 逾期 = `status ≠ done` 且 `dueDate < 今日`
  - 按 `assigneeId` 聚合（未指派任务不发），每人**一封日报**汇总其临期+逾期清单，返回 `{ notified, tasksScanned }` 统计。

### 3.5 即时通知接入点
三类写入皆经 `task.ts` 漏斗（网页 server action / AI commitDraft / CC agent 端点三端通吃），故在**非事务路径**的 `createTask`/`updateTask` 成功后 fire：
- `createTask`：若结果有 `assigneeId` → `notifyTaskAssigned`
- `updateTask`：`patch.assigneeId` 有变更 → `notifyTaskAssigned`（新负责人）；`patch.status === "done"` → `notifyTaskCompleted`
- **事务路径**（`commitDraft`）：createTask/updateTask 传 `tx` 时**抑制**内部通知，由 `commitDraft` 在事务 commit 之后对结果集统一补发（见 §4）。

### 3.6 定时提醒端点：`POST /api/cron/reminders`
- 校验 `CRON_SECRET`（`Authorization: Bearer` 或 header `x-cron-secret`；不符 → 401）
- 调 `scanAndNotifyDue()` → 返 `200 { notified, tasksScanned }`
- **幂等性**：每日调一次；同日重跑会重复发（外部调度职责为每日一击）。MVP 不做「当日已发」去重。
- 外部调度：NAS host crontab 或 docker-compose cron sidecar，每日固定时刻（建议早 9:00）打此端点。部署文档随实施补。

---

## 4. 事务化与通知时序（技术债并入）

**债**：`commitDraft` 的 `decompose_tasks`（循环 `createTask`）与 `plan_sprint`（循环 `updateTask`）无 `db.transaction`——中途抛错则前 k 项已落库、请求返错、用户重试致重复。

**正法**：
1. `createTask`/`updateTask` 增可选末参 `opts?: { tx?: DbTx }`：传 `tx` 则在该事务连接内执行，且**不触发即时通知**（因身处未提交事务）。
2. `commitDraft` 的 `decompose_tasks`/`update_tasks`/`plan_sprint` 三分支各以 `db.transaction(async (tx) => {...})` 裹住循环，全成则提交、任一抛则整体回滚。
3. 事务 `commit` 成功**之后**，`commitDraft` 对本批已落库的任务集统一 fire 通知（新建带 assignee → assigned；status→done → completed）。

**铁律**：通知永在事务提交之后。事务内绝不发私信，杜绝「回滚了但消息已出」。

---

## 5. 安全要点

- **OAuth `state`**：随机高熵存 cookie，回调比对，防 CSRF。
- **回调取用户身份**：绑定对象=**当前登录 session 用户**（`await auth()`），绝不信任回调 query 里的任何用户标识。
- **`open_id` 唯一**：一个飞书号只绑一个账号，冲突转译友好错误（守 [[agilecampus-auth-conventions]] 的 AppError 转译约定）。
- **`CRON_SECRET`**：高熵密钥，端点唯一护栏；缺失或不符即 401。
- **私信不阻断**：notify 全程 fire-and-forget，任何飞书侧故障不得影响任务落库。
- **未绑定静默**：无 `open_id` 即跳过，不报错、不重试。
- **凭证**：`.env` 存明文，不落库、不入日志、不回显。

---

## 6. 测试计划

| 层 | 用例 |
|---|---|
| `feishu.ts` | mock fetch：token 缓存命中/过期重取、code 换 openId、发消息 payload 正确、错误抛出 |
| `notify.ts` | mock feishu：未绑定跳过、完成通知操作者=创建者时不发、日报聚合正确 |
| OAuth 回调 | 集成：state 不符拒、成功绑定写字段、open_id 冲突转译 |
| cron 端点 | 鉴权（缺/错 secret → 401）、扫描临期+逾期正确聚合 |
| 事务化 | `commitDraft` 中途抛错整体回滚（无残留半批）、成功后通知补发 |
| `createTask` | 写入 `createdById`；带 assignee 触发 assigned 通知（mock notify） |

沿用 Vitest + 既有 `tests/setup.ts` 测试库策略。

---

## 7. 简化备案（MVP 取舍，市场化前重审）

- cron 端点无「当日已发」去重——逾期任务每日一提醒，靠外部调度每日一击天然节流；同日重跑会重复发。
- 日报仅按 assignee 聚合；未指派的临期/逾期任务无人可提醒（不发）。
- 完成通知仅发创建者一人；admin/teacher 全局视角后置。
- 飞书消息用纯文本，未做交互卡片（含「查看任务」跳转按钮）——富卡片后置。
- OAuth `state` 存 cookie 即可，未引入服务端 state 存储/一次性消费。
- token 缓存为进程内存——多实例各自缓存（各自换取，飞书侧允许）；未做共享缓存。
- 未做飞书事件订阅（如用户在飞书内退订/停用应用的回调）——绑定后飞书号失效时发送失败仅记日志。
- `scanAndNotifyDue` 全库扫描——任务量大时未分页/分批；当前规模可接受。

---

## 8. 建议实施顺序（供 writing-plans 展开）

1. **schema**：`tasks.createdById` + `db:push`；`createTask` 写入创建者（含测试）。
2. **`feishu.ts` 斥候**：三纯函数 + mock fetch 测（离线可验的地基）。
3. **OAuth 绑定 + 设置页 UI**：login/callback 路由 + `bindFeishu`/`unbindFeishu` + `/settings` 卡片 → **真机绑定验收**。
4. **`notify.ts` + 即时接入**：三通知函数 + `task.ts` 接入点 → 真机私信验收（被指派/完成）。
5. **事务化**：`createTask`/`updateTask` 收 `tx` + `commitDraft` 三分支裹事务 + 提交后补发通知（含回滚测）。
6. **cron 端点 + 定时扫描**：`/api/cron/reminders` + `scanAndNotifyDue` + 鉴权测；部署调度文档。

第 3、4 步须真机；其余离线可验。
