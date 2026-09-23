# AgileCampus 图三设计：灵魂（对话式 Agent）—— 上篇「对话地基 + 读工具」

日期：2026-07-22
状态：已获批准（陛下三节逐一准）
上游：`docs/superpowers/specs/2026-07-02-agilecampus-mvp-design.md`（§6 Agent 设计）

## 0. 背景与两项战略决策

图三即 MVP 设计文档 §2 之「灵魂」阶段——对话式 Agent、六件兵器（tool calling）、写操作两段式人工确认。图一（地基）、图二（骨架）已成并入主干，本图承其上建 Agent 编排层。

动手前对齐两处战略岔路：

1. **DeepSeek 接入 = 先离线打通**：以录制回放（fixed replay）验全链路与测试，零 API 成本；对话 UI 与工具契约先立骨架；DeepSeek 真接留待密钥齐备再演武。此策逼出「可注入 LLM client」的依赖倒置架构。
2. **图三切两图**：
   - **图三上（本文档）**：`conversations`/`messages` 两表 + 可注入 Agent 编排层 + 两读工具 + 对话 UI 骨架 + 快照注入 + replay 测试机制。
   - **图三下（后续）**：四写工具 + 两段式确认卡片 + 落库重校验。

## 1. 数据模型（两表）

MVP 简化：**对话依附项目**（非团队级），团队隔离经项目传导。

| 表 | 字段 |
|---|---|
| `conversations` | id、**projectId**（→ projects，onDelete cascade）、createdById（→ users）、title(可空)、createdAt |
| `messages` | id、conversationId（→ conversations，onDelete cascade）、role（枚举 user/assistant/tool）、content(text)、**toolCalls**(jsonb 可空，记工具调用与结果)、createdAt |

新增枚举 `message_role`（user / assistant / tool）。

设计要点：
- 对话归属**项目**——查询自项目起步，复用 `getProjectForUser` 做团队隔离，跨团队不可见。
- `messages.toolCalls` 存 jsonb，全量留痕，为图三下确认卡片与日后 AI 周报/复盘留原料。
- 读工具无写操作，直查即答。

## 2. Agent 编排层架构

**选型：Vercel AI SDK v5 + `@ai-sdk/openai-compatible`**（合上游 §3）。

权衡备案：舍「手写 OpenAI 兼容 fetch + 自造 tool loop」——须自实现工具解析、多轮循环、SSE 流式、重试，重复造轮，违「简洁第一」；AI SDK 已内建这些，且 model 天然可注入。

新增依赖：`ai`、`@ai-sdk/openai-compatible`。

**分层（新起 `src/lib/agent/`）：**

```
model.ts        # provider 装配：getModel() 读 env 返 DeepSeek provider；测试注入 mock
tools.ts        # 兵器谱：query_progress / list_tasks，tool({inputSchema, execute}) 定义，execute 调 lib 层
snapshot.ts     # 项目快照：组装系统提示（概要 + 里程碑 + 成员 + 任务统计），有大小上限
orchestrator.ts # 编排：model + 工具 + 消息历史 → generateText；消息落 messages 表
src/app/api/chat/route.ts               # Route Handler：鉴权 → 调编排 → 流式返回
src/app/(app)/projects/[projectId]/...  # 对话 UI（依附项目详情页）
```

**关键设计：**
- **可注入 model**：`getModel()` 生产返 `createOpenAICompatible({ name:'deepseek', baseURL, headers:{Authorization} })('deepseek-chat')`；orchestrator 收 `model` 参数，测试传 `MockLanguageModelV4`（`ai/test`）。依赖倒置由 AI SDK 内建，无须自造抽象接口。
- **读工具 execute**：
  - `query_progress`：调 `listProjectMilestones` + `listProjectTasks` 组进度统计（各状态计数、里程碑概况）。
  - `list_tasks`：调 `listProjectTasks` 加筛选（按负责人 / 状态 / 截止日）。
- **权限收敛**：编排入口经 `getProjectForUser` 一校（系统边界），工具 execute 内不重校（合「仅边界验证」）；工具参数经 `inputSchema`（Zod）校验。
- **快照上限**：超限只注统计摘要，细节由读工具现查（上游 §6.3）。

**错误处理（上游 §6.4）：**
- DeepSeek 超时/失败 → route 捕获，UI 明示可重试，不静默、不自动重试。
- 工具参数非法 → `inputSchema` Zod 拦截，AI SDK 回喂模型自纠一次，再失败如实呈报。
- 图三上无写操作，版本校验留图三下。

## 3. 对话 UI 与数据流

**UI 形态**：`/projects/[projectId]` 增「对话」区，客户端组件用 AI SDK `useChat` 接 `/api/chat`。消息流渲染 user/assistant 文本；工具调用轮渲染为「斥候回报」结构化小卡（query_progress / list_tasks 结果）。图三上只读工具，无确认卡片。

**数据流（一轮问答）：**

```
用户输入 → useChat POST /api/chat（projectId + 消息历史）
  → route 鉴权（auth + getProjectForUser，非成员 403）
  → orchestrator：注入项目快照系统提示 + 历史 → generateText(model, tools)
      → 模型请求 query_progress → execute 调 lib → 结果回模型 → 出文本
  → 全程 user/assistant/tool 消息落 messages 表
  → 流式返回 UI
```

## 4. 无密钥下的验收边界

陛下选「离线打通」，故验收分两档：

- **可验收（replay，零 API）**：工具 execute 单测、快照组装单测、`MockLanguageModelV4` 脚本化的「对话→工具→落库」集成测试全绿；两表 schema push；对话 UI 结构就位、可编译、路由通。
- **留待密钥齐备再验**：真实 DeepSeek 流式对话演武（真跑一轮真问答）。届时只填 `.env` 的 `DEEPSEEK_API_KEY`，`getModel()` 即切真 provider，无须改码。
- `.env.example` 追加 `DEEPSEEK_API_KEY=` 与 `DEEPSEEK_BASE_URL=https://api.deepseek.com` 占位。

## 5. 图三上验收清单

1. 两表 schema push 两库成
2. `query_progress` / `list_tasks` execute 纯函数单测绿（含权限与筛选）
3. 快照组装单测绿（含超限降级为摘要）
4. replay 集成测试：模型调 `query_progress` → 落库 `messages` → 出文本，全链路绿
5. 非成员 POST `/api/chat` → 403；跨项目参数越权被拒
6. `npx tsc --noEmit && npm test && npm run lint && npm run build` 全净
7. （留待密钥）真实 DeepSeek 一轮问答演武

## 6. 精确用法待核（作战图实施时）

- `ai` / `@ai-sdk/openai-compatible` 的安装版本与 `ai/test` 导出的 mock model 精确类名及 `usage`/`finishReason` 结构，以 npm 安装后为准。
- Next.js 16 Route Handler 流式返回的现行约定，依 `node_modules/next/dist/docs/`（AGENTS.md 军令）。
