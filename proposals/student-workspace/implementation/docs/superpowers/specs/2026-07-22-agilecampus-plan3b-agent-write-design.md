# AgileCampus 图三下设计：灵魂（对话式 Agent）—— 下篇「四写兵器 + 两段式确认」

日期：2026-07-22
状态：已获批准（陛下三节逐一准）
上游：`docs/superpowers/specs/2026-07-02-agilecampus-mvp-design.md`（§6.2 写操作两段式）
承接：`docs/superpowers/specs/2026-07-22-agilecampus-plan3-agent-design.md`（图三上·对话地基）

## 0. 背景与决策

图三上已建对话地基（两表、可注入编排层、两读兵器、请求-响应式面板）。图三下补 MVP 灵魂之下半——**四写兵器**与**写操作两段式人工确认**。

已对齐决策：
1. **一图打完**四写工具 + 两段式确认基础设施（陛下定，不切分）。
2. **plan_sprint 语义** = 归入里程碑 + 批量设截止日（里程碑作「迭代/时间段」载体，复用图二 milestone，无新表）。
3. **最小必要版本校验**：仅 `update_tasks`/`plan_sprint`（改现存任务）带 `updatedAt` 乐观锁比对；纯新建（create_project/decompose_tasks）免校。

## 1. 两段式确认架构

**第一段（Agent 产草案，不落库）：**
- 用户发消息 → `/api/chat` → `runAgentTurn`
- 写工具之 `execute` **只产结构化草案**（draft），**绝不落库**，并标注工具类型
- `runAgentTurn` 从 `result.steps` 收集写工具草案，随助手文本返回：`{ text, drafts: [{tool, draft}] }`
- 前端渲染助手文本 + 每草案一张**确认卡片**（字段可编辑 + 确认/驳回）

**第二段（人工确认后落库）：**
- 用户编辑毕点确认 → POST **`/api/chat/commit`**（`{projectId, tool, draft}`，draft 为编辑后值）
- 服务端**重新校验，绝不信 Agent 输出**：`auth` + `getProjectForUser`（权限）+ 对 draft 施 Zod（合法性）+ 调**图二既有 lib**（`createProject`/`createTask`/`updateTask`，各自再校权限与归属）落库
- 落库毕前端 `router.refresh()` 刷看板

**关键安全**：草案仅「预填的表单值」；落库走与人工操作**完全相同的 lib 路径**——Agent 越权所产草案，落库一刻被 lib 拒。此乃设计文档 §6.2「不信任 Agent 输出」之要害。

**草案留痕**：草案随 assistant 消息之 `toolCalls` jsonb 存档（图三上已有此列）；段二落库用前端传回的编辑后草案，不改 messages。

## 2. 四写兵器：草案形态与落库映射

四者皆复用图二 lib 落库，草案即「预填表单值」：

| 兵器 | 草案形态（execute 产，不落库） | 落库映射（commit 重校后） |
|---|---|---|
| **create_project** | `{name, description?, startDate?, endDate?}` | `createProject(userId, 本项目.teamId, draft)`；lib 要求 admin，越权草案被拒 |
| **decompose_tasks** | 任务清单 `[{title, description?, assigneeId?, dueDate?, milestoneId?, priority?}]` | 逐项 `createTask(userId, projectId, t)`；lib 要求 admin/student |
| **update_tasks** | 变更清单 `[{taskId, updatedAt, patch:{status?/assigneeId?/dueDate?/milestoneId?/priority?/title?}}]` | 逐项比 `updatedAt` 版本，再 `updateTask(userId, taskId, patch)`；冲突项收集返回、提示刷新 |
| **plan_sprint** | `{milestoneId, taskIds:[], dueDate}` | 逐 taskId `updateTask(userId, id, {milestoneId, dueDate})`——update_tasks 之特化，复用 updateTask |

**要点：**
- 拆解智能在 LLM——`decompose_tasks` 的 `execute` 收 Agent 拟好的任务数组（经 `inputSchema` Zod 校验），产草案回传，不落库；模型据草案出引导语。
- **落库端点按 tool 类型 dispatch**，每类先重施 Zod + 复用图二 lib。四工具落库只碰三 lib 函数（createProject/createTask/updateTask）——DRY，无新落库逻辑。
- `create_project` 的 teamId 由 `projectId` 反推（buildTools 已绑 projectId）。
- `plan_sprint` 与 `update_tasks` 落库同走 `updateTask`，仅草案形态不同——commit 可共用 update 逻辑。

## 3. 确认卡片 UI 与分层

**确认卡片**（嵌图三上 chat-panel）：助手回合若含草案，则在助手消息下渲染确认卡片（按 `draft.tool` 择形态）：
- create_project 卡：名称/描述/起止日输入
- decompose_tasks 卡：任务清单（每行 标题/负责人/优先级/截止日/里程碑，可增删改）
- update_tasks 卡：变更清单（原值→新值，可调）
- plan_sprint 卡：里程碑选择 + 任务多选 + 截止日

每卡有「确认落库」「驳回」；确认成功后标「已落库」+ `router.refresh()`。MVP 可编辑聚焦核心字段，余用合理默认。

**分层（新增/改动）：**
```
src/lib/agent/tools.ts            # 追加四写工具（execute 产草案不落库；写工具名单标识）
src/lib/agent/commit.ts           # 新：commitDraft(actorId, projectId, tool, draft) 落库 dispatch + 版本校验
src/lib/agent/orchestrator.ts     # runAgentTurn 返回增 drafts（提取写工具草案）
src/app/api/chat/commit/route.ts  # 落库端点（薄壳，调 commitDraft）
src/app/(app)/projects/[projectId]/draft-cards.tsx   # 新：四类草案卡片
src/app/(app)/projects/[projectId]/chat-panel.tsx    # 渲染草案卡片
```

## 4. 测试方略（replay + 直测，零 API）

- **写工具单元**：execute 产草案且**库中无新行**（验第一段不落库）。
- **replay 集成**：mock 脚本化「模型调 decompose_tasks → 产草案 → 返回」，断言 `drafts` 有任务清单、`tasks` 表仍空。
- **commit 直测**（不经 LLM）：`commitDraft` 各 tool 正确落库；**越权草案被 lib 拒**（student 产 create_project → 403）；update 版本冲突（updatedAt 不符）被拒。
- **安全靶心**：落库重校验覆盖非成员、越角色、版本冲突三路。

## 5. 验收边界

- **可验收（离线，零 API）**：四写工具产草案单测、`commitDraft` 落库/权限/版本直测、replay 集成、UI 卡片结构就位可编译。
- **留待密钥**：真实 DeepSeek 一轮「拆任务→确认→落库」演武（`getModel` 自动切真 provider）。

## 6. 验收清单

1. 四写工具 execute 产草案且不落库（单测绿）
2. replay：模型调 decompose_tasks → 返回 drafts、tasks 表仍空
3. commitDraft 四路正确落库（复用图二 lib）
4. 越权草案落库被拒（非成员/越角色 → ForbiddenError）
5. update/plan_sprint 版本冲突（updatedAt 不符）被拒、提示刷新
6. 确认卡片四类渲染 + 编辑 + 确认落库 + router.refresh 刷看板
7. `npx tsc --noEmit && npm test && npm run lint && npm run build` 全净
8. （留待密钥）真实 DeepSeek「拆任务→确认→落库」演武

## 7. 精确用法待核（作战图实施时）

- `runAgentTurn` 如何从 `result.steps` 区分读工具（直查结果）与写工具（草案）的 output——以写工具名单或草案标记字段实现，精确形态以 `ai@5` 的 `StepResult.toolResults` 类型为准。
- 确认卡片为客户端组件，须持有草案态、编辑、POST commit——与图三上请求-响应式面板一致。
