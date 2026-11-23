# AgileCampus 图五设计纲要：资源占用登记（D）+ CC 写入（F）

日期：2026-07-22
状态：**纲要（供新会话 brainstorm / writing-plans 接续，尚未实施）**
承接：图四（任务增强+总览）已并入 master。

> 本文非完整作战图，而是新会话开局用的架构纲要：对齐数据模型、共用认证根基、关键决策与待定项。新会话可据此直接进入 `brainstorming`（补齐待定决策）→ `writing-plans`。

## 0. 背景

陛下两需求，本质共用一套「外部写入」根基：
- **D 资源占用登记**：团队共享的服务器/算力等资源，成员**登记**「谁·占用何资源·起止时段·时长·用途」，**纯登记、无需审批**（陛下已定），且 CC 可写入。
- **F CC 写入**：Claude Code 可直接「添加任务 / 填完成情况 / 登记资源占用」。

CC 乃浏览器之外的外部调用，走不通现有登录 session，须另建 **Personal API Token 认证**——此乃 D 的「CC 写入」与 F 的共同根基，故二者一体设计。

## 1. 共用根基：Personal API Token 认证

**数据**：`api_tokens(id, userId → users cascade, name, tokenHash, createdAt, lastUsedAt?, revokedAt?)`
- token 明文仅生成时显示一次；库中只存 hash（sha256 或 bcrypt）。

**业务（新 lib，如 `src/lib/api-token.ts`）**：
- `createApiToken(userId, name)` → `{ id, token明文 }`（明文只此一次返回）
- `verifyApiToken(rawToken)` → `userId | null`（hash 比对未撤销的 token；命中则更新 lastUsedAt）
- `listApiTokens(userId)` / `revokeApiToken(userId, id)`

**认证中间层**：新增一组 `/api/agent/*` 端点，用 `Authorization: Bearer <token>` 认证（区别于浏览器 session 的 `/api/chat`）。流程：取 header token → `verifyApiToken` → 得 userId → **复用图二/图三下既有 lib**（lib 内建对 team/project 的权限校验）。**外部写入绝不信任——token 换来的 userId 只有该用户权限，越权由 lib 拒**（与图三下「不信任 Agent 输出」同理）。

**生成 UI**：设置页（如 `/settings/tokens`）——生成/命名/撤销 token，明文只显一次并提示复制。

## 2. D 资源占用登记

**数据**：`resource_usages(id, teamId → teams cascade, userId → users, resourceName, purpose?, startTime timestamp, endTime timestamp?（可空=进行中）, createdAt)`
- 时长 = `endTime - startTime`（结束后计算）；进行中（endTime 空）显示「占用中」。

**业务（`src/lib/resource.ts`）**：
- `createResourceUsage(actorId, teamId, { resourceName, purpose?, startTime, endTime? })`——复用 `requireTeamRole`/`getTeamMembership` 校验成员身份。
- `endResourceUsage(actorId, usageId)`——结束进行中的占用（设 endTime=now）。
- `listTeamResourceUsages(actorId, teamId)`——列表 + 每人/每资源时长汇总。

**UI**：团队级 `/teams/[teamId]/resources` ——登记表单（资源名·用途·起止）+ 占用列表 + 时长统计。沿用「学术工作台」设计系统（`.ac-card`/`.ac-field`/`.ac-btn`）。

**CC 写入**：`POST /api/agent/resource-usage`（token 认证）→ `createResourceUsage`。

## 3. F CC 写入（任务/完成情况/资源）

**Token 认证的 agent 端点**（`/api/agent/*`，复用 lib）：
- `POST /api/agent/tasks` → `createTask`（建任务，body: projectId + 任务字段）
- `POST /api/agent/tasks/complete` → `updateTask`（填完成情况：status=done + completionNote）
- `POST /api/agent/resource-usage` → `createResourceUsage`（D 共用）

每端点：verifyApiToken → userId → Zod 校验 body → 调 lib（lib 校验该 userId 对目标 project/team 的权限）。

**CC skill**（`.claude/skills/agilecampus/`，或用户全局 skill）：封装对上述端点的调用——用户在 Claude Code 里说「给项目 X 加任务 Y」「把任务 Z 标记完成，情况是…」「登记我占用了 GPU-01 三小时」，skill 携配置好的 token + baseURL 调 API。需引导用户：① 在设置页生成 token ② 配置 token/baseURL 到 skill。

## 4. 安全要点
- token 存 hash，明文只显一次，可撤销（泄露即撤）。
- `/api/agent/*` 全部走 token→userId→lib 权限，**外部输入不被信任**；越权（改别队任务/登记别队资源）由 lib 拒（403）。
- token 作用域=该用户全部权限（MVP）；如需更细（限定项目）留后续。
- 端点须防滥用（可选：速率限制，MVP 后置）。

## 5. 待定决策（新会话 brainstorm 时对齐；括号内为瑜之建议默认）
1. **token 作用域**：全权 vs 限定项目？（荐：全权=该用户权限，简单；细粒度后置）
2. **token 数量/过期**：一用户多 token、可命名、可撤销、无过期（撤销即失效）？（荐：是）
3. **资源名**：自由填 vs 预定义列表？（荐：MVP 自由填名 + 关联团队；预定义资源池后置）
4. **占用建模**：start+end（可空=进行中，支持「结束占用」）vs 仅时长数字？（荐：start+end 可空）
5. **资源归属**：团队级（共享池）vs 项目级？（荐：团队级）
6. **CC skill 形态**：Claude Code skill（.claude/skills/）封装 API 调用；范围=加任务/填完成/登记资源。（荐：是）
7. **CC 是否也读**（查进度/列任务）：本纲要仅「写入」（陛下所命）；读端点可后续加。

## 6. 建议实施顺序（新会话）
1. **Personal API Token 认证**（根基：schema + lib + 设置页 UI + verifyApiToken 中间层）
2. **D 资源占用登记**（schema + lib + 团队资源页 UI + `/api/agent/resource-usage` 端点）
3. **F 其余 agent 端点 + CC skill**（tasks / tasks-complete 端点 + skill 封装 + 使用引导）

## 7. 尚未攻取之其余需求（记档，非本纲要范围）
- **C 实验时间线查勘**：timeline 视图；依赖为任务加 `startDate`（图四已可低成本加）。属「图六·时间线/管理视图」候选。
- **E 接入飞书**：通知/同步；**须陛下先备飞书应用凭证 AppID/Secret**。独立集成批次。
- 调研报告详见对话记录（科研场景六诉求 + 跨项目看板/甘特分期路径 + 优先级 Top）；如需可整理入 `docs/`。
