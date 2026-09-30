# 飞书登录 + 展示卡片 设计

**Goal:** 让 AgileCampus 支持以飞书身份直接登录（嵌入飞书客户端内免登、外部浏览器 OAuth 按钮），并将三类机器人通知（指派/完成/日报）从纯文本升级为展示型飞书卡片，卡片「查看详情」深链回嵌入网页对应任务。

**Tech Stack:** Next.js 16 (App Router) · Auth.js v5 (Credentials provider) · Drizzle ORM + PostgreSQL · 飞书自建应用（OAuth + JSSDK 网页应用免登 + 消息卡片）· Zod · Vitest

---

## 1. 需求边界

- **飞书登录**：混合账号映射 + 两路兼备（OAuth 按钮 + JSSDK 免登），一次做完。
- **展示卡片**：三类通知（指派/完成/日报）全升级为 interactive 卡片，含「查看详情」深链；无就地交互按钮（不引入飞书事件回调）。
- **不在范围**：卡片就地操作（标记完成等回调）、飞书事件订阅、多语言卡片。

---

## 2. 架构总览

两桩功能共用主线：**飞书身份 ↔ AgileCampus 账号 ↔ 嵌入网页**。登录引入飞书身份；卡片深链把用户导回网页。核心巧构：**OAuth 与 JSSDK 两路殊途同归**——皆归结为「拿飞书 code → 用 code 登录」，故 session 建立只需**一个 NextAuth provider**。

---

## 3. 需求一 · 飞书登录

### 3.1 provider 归一

新增 NextAuth `Credentials` provider `id: "feishu"`，`authorize({ code })`：

```
signIn("feishu", { code })
  └─ authorize: exchangeOAuthCode(code) → openId
       ├─ openId 已绑某账号（users.feishuOpenId 命中）→ 返回该 user（登录）
       └─ 未命中 → findOrCreateByFeishu(openId, name) 自动建号 → 返回新 user
  └─ NextAuth 建 JWT session
```

**安全**：`authorize` 收飞书**一次性 code**（非客户端可伪造的 openId），服务端换取 openId 后方可信。两路（OAuth/JSSDK）都只把 code 交给此 provider。

### 3.2 两路拿 code

- **OAuth 按钮**（外部浏览器 / 飞书内首次）：登录页「飞书登录」按钮 → `feishu/login` route 发起 authorize → `feishu/callback` route 拿 code → 前端 `signIn("feishu", {code})`。飞书内已授权用户，authorize 端点静默 302 回跳，近似免登。
- **JSSDK 免登**（飞书客户端内）：见 §3.4。

### 3.3 混合账号映射（数据模型）

`users` 表现状：`email` notNull+unique、`passwordHash` notNull、`feishuOpenId` unique（已有）。**不改 schema**，`findOrCreateByFeishu` 建号时：

| 字段 | 值 | 说明 |
|---|---|---|
| `email` | `{openId}@feishu.local` | 合成占位，满足 notNull+unique；此类账号不可邮箱登录 |
| `passwordHash` | 随机不可用 hash（bcrypt 随机串） | 永不匹配任何密码，即禁邮箱登录路径 |
| `name` | 飞书 name | |
| `feishuOpenId` / `feishuName` / `feishuBoundAt` | 飞书身份 + now() | |

新号无团队 → 登录后落 `/teams` 空态，复用现有「创建团队 / 邀请码加入」入口（无需新页面）。

### 3.4 JSSDK 免登

```
飞书内打开登录页
  → 前端探 window.h5sdk 存在
  → GET /api/feishu/jssdk-config?url=<当前页URL>
       服务端：getJsapiTicket()(缓存) → sha1(jsapi_ticket=…&noncestr=…&timestamp=…&url=…) → {appId,timestamp,nonceStr,signature}
  → h5sdk.config(签名) → h5sdk.ready(() => tt.requestAuthCode({appId}))  静默拿 code
  → signIn("feishu", { code })  （归入 §3.1 同一 provider）
```

非飞书环境（`window.h5sdk` 不存在）→ 渲染「飞书登录」按钮走 OAuth 路。一个 client 组件 `FeishuLogin` 收敛双态。

**飞书后台前置**（人工配，非代码）：开通「网页应用」能力 + 配置桌面/移动端主页 URL。

### 3.5 现有绑定路径保留

`/settings` 的「已登录用户补绑飞书」不动，与「飞书登录」并行不悖。

### 3.6 文件（需求一）

| 文件 | 动作 |
|---|---|
| `src/lib/auth.ts` | 加 `Credentials({ id: "feishu", authorize })` |
| `src/lib/user.ts` | `findOrCreateByFeishu(openId, name)` |
| `src/lib/feishu.ts` | `getJsapiTicket()`（缓存）+ JSSDK 签名辅助 |
| `src/app/api/feishu/jssdk-config/route.ts` | 新建：签发 config 签名 |
| `src/app/(auth)/login/feishu-login.tsx` | 新建：免登/按钮双态 client 组件 |
| `src/app/(auth)/login/page.tsx` | 嵌入 `FeishuLogin` |

---

## 4. 需求二 · 展示卡片

### 4.1 斥候层

`feishu.ts` 加 `sendCardMessage(openId, card)`：`im/v1/messages`，`msg_type: "interactive"`，`content = JSON.stringify(card)`。保留 `sendTextMessage` 备用。

### 4.2 卡片模板

抽出 `src/lib/feishu-card.ts`（`notify.ts` 保持聚焦业务）：

| 通知 | 卡片内容 | 按钮 |
|---|---|---|
| 指派 | 头「🎯 新任务指派」+ 标题/项目/负责人/截止/优先级 | 「查看详情」→ 深链 |
| 完成 | 头「✅ 任务完成」+ 标题/项目/完成情况 | 「查看详情」→ 深链 |
| 日报 | 头「⏰ 任务提醒」+ 逾期栏/临期栏列表 | 「查看项目」→ 深链 |

### 4.3 深链闭环

按钮 URL = `${AGILECAMPUS_URL}/projects/{projectId}?task={taskId}` → 飞书内点击 → JSSDK 免登 → 项目页读 `?task=` **自动打开任务详情弹窗**。

### 4.4 数据充实

现有 `notify` 的 `TaskRow` 仅 id/title/dueDate/assigneeId。卡片需**项目名、负责人名、优先级**。`createTask`/`updateTask` 返回 row 已含 `projectId`/`priority`；`notify` 三函数补 join 查 project name、assignee name。

### 4.5 文件（需求二）

| 文件 | 动作 |
|---|---|
| `src/lib/feishu.ts` | `sendCardMessage` |
| `src/lib/feishu-card.ts` | 新建：三类卡片构造 + 深链拼装 |
| `src/lib/notify.ts` | 三函数改调卡片 + 补查字段 |
| `src/app/(app)/projects/[projectId]/page.tsx` | 支持 `?task=` 深链打开弹窗 |

---

## 5. 安全边界

- 飞书登录 `authorize` 收 code（一次性、飞书签发），服务端换 openId，绝不信客户端传的 openId。
- JSSDK config 签名含 `timestamp`/`nonceStr` 防重放；`url` 取自请求。
- 无密码账号 `passwordHash` 为随机不可用 hash，邮箱密码登录路径对其永远失败。
- 合成占位 email `{openId}@feishu.local` 不与真实邮箱冲突（`.local` 保留域）。
- OAuth `state` cookie 防 CSRF（现有机制沿用）。

---

## 6. 测试策略

| 单元 | 用例 |
|---|---|
| `findOrCreateByFeishu` | 已存 openId→返回原 user；新 openId→建号(占位 email/hash)；建号后可再登录复用 |
| feishu provider authorize | mock exchangeOAuthCode：已绑→登录；未绑→建号 |
| `getJsapiTicket` + 签名 | mock fetch：ticket 缓存命中；签名串格式正确 |
| `sendCardMessage` | mock fetch：msg_type=interactive、content 为卡片 JSON |
| `feishu-card` 构造 | 三类卡片字段齐全、深链 URL 正确拼装 |
| `notify` 三函数 | mock feishu：卡片路径被调、收件人正确、未绑跳过 |
| `?task=` 深链 | 项目页读 query 打开对应任务弹窗 |

`.env.test` 无飞书凭证——飞书相关测试用 `vi.stubEnv` + mock fetch，不打真机（沿本项目一贯）。

---

## 7. 简化备案（MVP 取舍，市场化前重审）

- 合成占位 email `{openId}@feishu.local`：若同一自然人既有邮箱账号又飞书登录，会成两个账号（未做身份合并）；MVP 不处理，绑定路径仍在设置页可补绑。
- 无密码账号无法自助设密码/找回；如需转邮箱登录须另设「设置密码」入口（后置）。
- JSSDK config `jsapi_ticket` 进程内缓存，多实例各自取（飞书侧允许）。
- 卡片为展示型，无就地操作按钮（不引入飞书事件回调）；就地「标记完成」后置。
- 日报卡片列表长时不分页（任务量大时卡片偏长），当前规模可接受。
- `?task=` 深链仅打开弹窗，未做无效 taskId 的友好降级（弹窗内查不到即普通报错）。

---

## 8. 建议实施顺序

1. **数据/业务地基**：`findOrCreateByFeishu`（含占位 email/hash 与测试）。
2. **feishu provider**：`auth.ts` 加 feishu Credentials provider（authorize 复用 exchangeOAuthCode + findOrCreateByFeishu），OAuth callback 改为 `signIn("feishu")`。
3. **登录页 UI**：`FeishuLogin` 双态组件 + 登录页嵌入（先 OAuth 按钮路可端到端验收）。
4. **JSSDK 免登**：`getJsapiTicket` + 签名端点 + 前端 `h5sdk` 免登分支。
5. **卡片斥候**：`sendCardMessage` + `feishu-card` 模板。
6. **notify 卡片化**：三函数补查字段 + 改调卡片。
7. **深链弹窗**：项目页 `?task=` 支持。

> 飞书 API（OAuth code 换取、JSSDK ticket/签名串、`tt.requestAuthCode`、卡片 JSON schema）实现前以飞书开放平台官方文档核验，仅调 URL/字段名、不改本设计架构与函数签名。
