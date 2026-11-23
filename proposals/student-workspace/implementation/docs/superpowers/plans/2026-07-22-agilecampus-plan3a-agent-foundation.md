# AgileCampus 作战图三上：对话地基 + 读工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图二骨架之上建对话式 Agent 之地基——conversations/messages 两表、可注入 LLM 的编排层、两件读兵器（query_progress / list_tasks）、请求-响应式对话面板，全链路以 MockLanguageModelV2 录制回放（replay）离线验证，零 API 成本。

**Architecture:** 沿用图一/图二分层。Agent 逻辑聚于 `src/lib/agent/`：`model.ts`（DeepSeek provider 装配，仅生产调用）、`snapshot.ts`（项目快照系统提示，含上限降级）、`tools.ts`（读工具纯函数 + `tool()` 装配）、`conversation.ts`（会话与消息落库）、`orchestrator.ts`（`runAgentTurn` 以 `generateText` + `stopWhen: stepCountIs` 跑多步工具循环）。编排入口经 `getOrCreateConversation` → `getProjectForUser` 收敛权限（系统边界一校）。`model` 参数可注入：生产用 `getModel()`，测试注 `MockLanguageModelV2`。route + UI 为薄壳。

**Tech Stack:** 图二既有栈 + `ai@^5`（Vercel AI SDK v5）+ `@ai-sdk/openai-compatible`（DeepSeek OpenAI 兼容 provider）。

**设计文档：** `docs/superpowers/specs/2026-07-22-agilecampus-plan3-agent-design.md`

**关键实施决策（对设计文档第 3 节的调整，已获陛下确认）：** 对话 UI 采**请求-响应式**（`generateText` 非流式 + 普通 JSON route + 轻量自建面板），使 route 与 UI 亦能用 mock 端到端离线验证。真流式（`useChat` + `toUIMessageStreamResponse`）列 BACKLOG 作后续增强——无密钥时流式无从离线验证，YAGNI。

**约定沿用：** `@/`→src、`AppError`/`ForbiddenError`（`@/lib/errors`）、所有 server action/route 入口自 `auth()`、测试 `resetDb` + `makeUser`/`scene` 脚手架、date 字段用字符串（`YYYY-MM-DD`）。

---

## 文件结构总览

```
src/db/schema.ts                                    # 追加 messageRoleEnum + conversations + messages（补 import jsonb）
tests/helpers.ts                                    # resetDb TRUNCATE 追加 messages, conversations（子表在前）
.env.example                                        # 追加 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL 占位
src/lib/agent/model.ts                              # getModel() → DeepSeek provider（仅生产）
src/lib/agent/snapshot.ts                           # buildProjectSnapshot(actorId, projectId) → 系统提示串（含上限降级）
src/lib/agent/tools.ts                              # queryProgress / listTasksFiltered 纯函数 + buildTools 装配 tool()
src/lib/agent/conversation.ts                       # getOrCreateConversation / persistTurn / listConversationMessages
src/lib/agent/orchestrator.ts                       # runAgentTurn（generateText + stopWhen，靶心）
src/app/api/chat/route.ts                           # POST 鉴权 → runAgentTurn → JSON
src/app/(app)/projects/[projectId]/chat-panel.tsx   # 请求-响应式对话面板（客户端）
src/app/(app)/projects/[projectId]/page.tsx         # 挂载 ChatPanel
README.md / docs/BACKLOG.md                         # 收尾：路由/文档/备案
tests/agent-tools.test.ts                           # 读工具纯函数
tests/agent-snapshot.test.ts                        # 快照组装与降级
tests/agent-conversation.test.ts                    # 会话与落库
tests/agent-orchestrator.test.ts                    # replay 全链路（靶心）
package.json                                        # +ai +@ai-sdk/openai-compatible
```

---

### Task 1: 依赖安装 + env 占位

**Files:**
- Modify: `package.json`（经 npm install）
- Modify: `.env.example`
- Modify: `.env`（本地，追加空占位，不入库）

- [ ] **Step 1: 安装 AI SDK**

Run:
```bash
npm install ai@^5 @ai-sdk/openai-compatible
```
Expected: `package.json` dependencies 出现 `ai` 与 `@ai-sdk/openai-compatible`，无 peer 冲突报错。

- [ ] **Step 2: 追加 `.env.example` 占位（末尾）**

```
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

- [ ] **Step 3: 本地 `.env` 同步占位（保证 build/test 时 env 存在，值可空）**

在本地 `.env` 末尾追加同样两行（`DEEPSEEK_API_KEY=` 留空即可——测试注入 mock，不触发 `getModel()`）。此文件不入库。

- [ ] **Step 4: 验证安装不破坏现有测试**

Run:
```bash
docker compose up -d
npx tsc --noEmit && npm test
```
Expected: tsc 干净、45 tests 全绿（无回归）。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: 接入 Vercel AI SDK v5 与 DeepSeek provider 占位"
```

---

### Task 2: Schema 两表 + resetDb

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: `src/db/schema.ts` import 补 `jsonb`**

将首部 import 块改为（追加 `jsonb`）：
```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  date,
  doublePrecision,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: 文件末尾追加枚举与两表**

```ts
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_idx").on(t.projectId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);
```

- [ ] **Step 3: `tests/helpers.ts` 的 TRUNCATE 追加两表（子表在前）**

```ts
export async function resetDb() {
  await db.execute(
    sql`TRUNCATE messages, conversations, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 4: push 两库并验证**

```bash
npm run db:push
npm run db:push:test
docker compose exec db psql -U agilecampus -d agilecampus -c '\dt' | grep -E 'conversations|messages' && echo SCHEMA-OK
docker compose exec db psql -U agilecampus -d agilecampus_test -c '\dt' | grep messages && echo TEST-SCHEMA-OK
npx tsc --noEmit && npm test
```
Expected: SCHEMA-OK、TEST-SCHEMA-OK、tsc 干净、45 tests 不回归。

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts tests/helpers.ts
git commit -m "feat: schema 扩展——conversations/messages 两表与 message_role 枚举"
```

---

### Task 3: 读工具纯函数（TDD）

**Files:**
- Create: `tests/agent-tools.test.ts`
- Create: `src/lib/agent/tools.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-tools.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask } from "@/lib/task";
import { queryProgress, listTasksFiltered } from "@/lib/agent/tools";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

describe("queryProgress", () => {
  beforeEach(resetDb);

  it("汇总任务状态计数与里程碑概况", async () => {
    const { owner, student, project } = await scene();
    await createMilestone(owner.id, project.id, { title: "中期答辩", targetDate: "2026-11-15" });
    await createTask(student.id, project.id, { title: "甲" });
    await createTask(student.id, project.id, { title: "乙" });

    const r = await queryProgress(student.id, project.id);
    expect(r.taskTotal).toBe(2);
    expect(r.byStatus.todo).toBe(2);
    expect(r.byStatus.doing).toBe(0);
    expect(r.milestoneTotal).toBe(1);
    expect(r.milestones[0].title).toBe("中期答辩");
  });

  it("非成员被拒（复用 lib 权限）", async () => {
    const { outsider, project } = await scene();
    await expect(queryProgress(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("listTasksFiltered", () => {
  beforeEach(resetDb);

  it("按状态与负责人筛选", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "甲", assigneeId: student.id });
    await createTask(student.id, project.id, { title: "乙" });

    const all = await listTasksFiltered(student.id, project.id, {});
    expect(all).toHaveLength(2);

    const mine = await listTasksFiltered(student.id, project.id, { assigneeId: student.id });
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("甲");
    expect(mine[0].assigneeName).toBe("student");

    const todos = await listTasksFiltered(student.id, project.id, { status: "todo" });
    expect(todos).toHaveLength(2);
  });

  it("按截止日筛（dueBefore 含当日）", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "早", dueDate: "2026-10-01" });
    await createTask(student.id, project.id, { title: "晚", dueDate: "2026-12-01" });
    const due = await listTasksFiltered(student.id, project.id, { dueBefore: "2026-10-31" });
    expect(due).toHaveLength(1);
    expect(due[0].title).toBe("早");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-tools.test.ts
```
Expected: FAIL（`@/lib/agent/tools` 不存在）。

- [ ] **Step 3: 实现 `src/lib/agent/tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";
import { listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import type { TaskStatus } from "@/db/schema";

// 读工具纯函数：权限经底层 lib（listProjectMilestones/listProjectTasks 内部各调 getProjectForUser）
export async function queryProgress(actorId: string, projectId: string) {
  const [ms, ts] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
  ]);
  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const t of ts) byStatus[t.status]++;
  return {
    taskTotal: ts.length,
    byStatus,
    milestoneTotal: ms.length,
    milestones: ms.map((m) => ({
      title: m.title,
      status: m.status,
      targetDate: m.targetDate,
    })),
  };
}

export async function listTasksFiltered(
  actorId: string,
  projectId: string,
  filters: { status?: TaskStatus; assigneeId?: string; dueBefore?: string },
) {
  let list = await listProjectTasks(actorId, projectId);
  if (filters.status) list = list.filter((t) => t.status === filters.status);
  if (filters.assigneeId) list = list.filter((t) => t.assigneeId === filters.assigneeId);
  if (filters.dueBefore)
    list = list.filter((t) => t.dueDate !== null && t.dueDate <= filters.dueBefore!);
  return list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeName: t.assigneeName,
  }));
}

// AI SDK 工具装配：绑定 actorId/projectId，execute 委托纯函数
export function buildTools(actorId: string, projectId: string) {
  return {
    query_progress: tool({
      description: "查询该项目进度统计：各状态任务数、里程碑概况。无需参数。",
      inputSchema: z.object({}),
      execute: async () => queryProgress(actorId, projectId),
    }),
    list_tasks: tool({
      description: "按状态、负责人、截止日筛选该项目任务。",
      inputSchema: z.object({
        status: z.enum(["todo", "doing", "done"]).optional(),
        assigneeId: z.string().optional().describe("负责人用户 id"),
        dueBefore: z.string().optional().describe("截止日不晚于此日期（YYYY-MM-DD）"),
      }),
      execute: async (filters) => listTasksFiltered(actorId, projectId, filters),
    }),
  };
}
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-tools.test.ts src/lib/agent/tools.ts
git commit -m "feat: Agent 读兵器——query_progress/list_tasks（复用 lib 权限）"
```
Expected: 全量 51 passed（45+6）。

---

### Task 4: 项目快照系统提示（TDD）

**Files:**
- Create: `tests/agent-snapshot.test.ts`
- Create: `src/lib/agent/snapshot.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-snapshot.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask } from "@/lib/task";
import { buildProjectSnapshot } from "@/lib/agent/snapshot";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, {
    name: "赤壁演习",
    description: "冬季项目",
  });
  return { owner, team, student, project };
}

describe("buildProjectSnapshot", () => {
  beforeEach(resetDb);

  it("含项目名、成员、任务统计", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "甲" });
    const snap = await buildProjectSnapshot(student.id, project.id);
    expect(snap).toContain("赤壁演习");
    expect(snap).toContain("student");
    expect(snap).toContain("任务");
  });

  it("里程碑过多时降级为统计摘要（不逐条列出）", async () => {
    const { owner, project } = await scene();
    for (let i = 0; i < 60; i++) {
      await createMilestone(owner.id, project.id, {
        title: `里程碑编号第${i}个用于撑爆快照上限的冗长标题填充填充填充`,
      });
    }
    const snap = await buildProjectSnapshot(owner.id, project.id);
    expect(snap).toContain("共 60 个里程碑");
    expect(snap).not.toContain("里程碑编号第59个");
  });

  it("非成员被拒", async () => {
    const outsider = await makeUser("outsider@example.com");
    const { project } = await scene();
    await expect(buildProjectSnapshot(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-snapshot.test.ts
```
Expected: FAIL（`@/lib/agent/snapshot` 不存在）。

- [ ] **Step 3: 实现 `src/lib/agent/snapshot.ts`**

```ts
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { ForbiddenError } from "@/lib/errors";
import type { TaskStatus } from "@/db/schema";

const SNAPSHOT_CHAR_LIMIT = 2000;

export async function buildProjectSnapshot(actorId: string, projectId: string): Promise<string> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  const { project } = access;

  const [milestones, tasks, members] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
    listTeamMembers(project.teamId),
  ]);

  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const t of tasks) byStatus[t.status]++;

  const head = [
    `# 当前项目：${project.name}`,
    project.description ? `描述：${project.description}` : null,
    `状态：${project.status}；起止：${project.startDate ?? "?"} ~ ${project.endDate ?? "?"}`,
    `成员：${members.map((m) => `${m.name}(${m.role})`).join("、")}`,
    `任务统计：共 ${tasks.length} 个（待办 ${byStatus.todo} / 进行中 ${byStatus.doing} / 已完成 ${byStatus.done}）`,
    `里程碑：共 ${milestones.length} 个`,
  ]
    .filter(Boolean)
    .join("\n");

  const milestoneDetail =
    milestones.length > 0
      ? "\n里程碑明细：\n" +
        milestones.map((m) => `- ${m.title}（${m.status}${m.targetDate ? ` @ ${m.targetDate}` : ""}）`).join("\n")
      : "";

  const full = head + milestoneDetail;
  // 超限降级：只留统计头（含"共 N 个里程碑"），明细由读工具现查
  return full.length > SNAPSHOT_CHAR_LIMIT ? head : full;
}
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-snapshot.test.ts src/lib/agent/snapshot.ts
git commit -m "feat: 项目快照系统提示（含上限降级为统计摘要）"
```
Expected: 全量 54 passed（51+3）。

---

### Task 5: 会话与消息落库（TDD）

**Files:**
- Create: `tests/agent-conversation.test.ts`
- Create: `src/lib/agent/conversation.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-conversation.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  getOrCreateConversation,
  persistTurn,
  listConversationMessages,
} from "@/lib/agent/conversation";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

describe("getOrCreateConversation", () => {
  beforeEach(resetDb);

  it("首次创建，二次复用同一会话", async () => {
    const { student, project } = await scene();
    const c1 = await getOrCreateConversation(student.id, project.id);
    const c2 = await getOrCreateConversation(student.id, project.id);
    expect(c1.id).toBe(c2.id);
  });

  it("非成员被拒", async () => {
    const { outsider, project } = await scene();
    await expect(getOrCreateConversation(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("persistTurn / listConversationMessages", () => {
  beforeEach(resetDb);

  it("落一轮 user+assistant 消息，assistant 携工具轨迹", async () => {
    const { student, project } = await scene();
    const conv = await getOrCreateConversation(student.id, project.id);
    await persistTurn(conv.id, "项目进度如何？", "共有 2 个任务。", [
      { toolName: "query_progress", input: {}, output: { taskTotal: 2 } },
    ]);

    const msgs = await listConversationMessages(student.id, conv.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("项目进度如何？");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("共有 2 个任务。");
    expect(msgs[1].toolCalls).toEqual([
      { toolName: "query_progress", input: {}, output: { taskTotal: 2 } },
    ]);
  });

  it("listConversationMessages 非成员被拒", async () => {
    const { student, outsider, project } = await scene();
    const conv = await getOrCreateConversation(student.id, project.id);
    await expect(listConversationMessages(outsider.id, conv.id)).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-conversation.test.ts
```
Expected: FAIL（`@/lib/agent/conversation` 不存在）。

- [ ] **Step 3: 实现 `src/lib/agent/conversation.ts`**

```ts
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { ForbiddenError, AppError } from "@/lib/errors";

// 每项目复用最近一条会话（MVP 简化：每项目一活跃会话）
export async function getOrCreateConversation(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({ projectId, createdById: actorId })
    .returning();
  return created;
}

export type ToolTraceEntry = { toolName: string; input: unknown; output: unknown };

export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
  toolTrace: ToolTraceEntry[],
) {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userText },
    {
      conversationId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolTrace.length > 0 ? toolTrace : null,
    },
  ]);
}

export async function listConversationMessages(actorId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conv) throw new AppError("会话不存在");
  const access = await getProjectForUser(actorId, conv.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}
```

注：两行同一 `insert().values([...])`，`createdAt` 均取 DB `defaultNow()`；`asc(createdAt)` 排序对同批时间戳依赖数组插入序，PostgreSQL 按 values 数组序写入，user 先于 assistant。

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-conversation.test.ts src/lib/agent/conversation.ts
git commit -m "feat: 会话与消息落库——getOrCreateConversation/persistTurn/list"
```
Expected: 全量 58 passed（54+4）。

---

### Task 6: 编排层 model + runAgentTurn（replay 靶心，TDD）

**Files:**
- Create: `src/lib/agent/model.ts`
- Create: `tests/agent-orchestrator.test.ts`
- Create: `src/lib/agent/orchestrator.ts`

- [ ] **Step 1: 实现 `src/lib/agent/model.ts`（无独立测试——仅生产装配，测试注入 mock）**

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";

// 仅在生产（route 未注入 model）时调用；测试注入 MockLanguageModelV2，不触达此函数
export function getModel(): LanguageModel {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AppError("DeepSeek 未配置：请在 .env 设置 DEEPSEEK_API_KEY");
  const deepseek = createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return deepseek("deepseek-chat");
}
```

- [ ] **Step 2: 写失败测试 `tests/agent-orchestrator.test.ts`（replay 全链路）**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listConversationMessages } from "@/lib/agent/conversation";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

// 录制脚本：第一轮请求调 query_progress 工具，第二轮据结果出文本
function replayModel() {
  return new MockLanguageModelV2({
    doGenerate: [
      {
        finishReason: "tool-calls",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "query_progress", input: "{}" },
        ],
        warnings: [],
      },
      {
        finishReason: "stop",
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        content: [{ type: "text", text: "该项目当前共有 1 个任务，均待办。" }],
        warnings: [],
      },
    ],
  });
}

describe("runAgentTurn（replay）", () => {
  beforeEach(resetDb);

  it("模型调 query_progress → 落库 → 出文本", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "甲" });

    const result = await runAgentTurn({
      actorId: student.id,
      projectId: project.id,
      userText: "项目进度如何？",
      model: replayModel(),
    });

    expect(result.text).toContain("1 个任务");

    // 落库：user + assistant 两行，assistant 携 query_progress 轨迹
    const msgs = await listConversationMessages(student.id, result.conversationId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    const trace = msgs[1].toolCalls as { toolName: string }[];
    expect(trace.some((e) => e.toolName === "query_progress")).toBe(true);
  });

  it("非成员被拒（编排入口经会话创建收敛权限）", async () => {
    const { outsider, project } = await scene();
    await expect(
      runAgentTurn({
        actorId: outsider.id,
        projectId: project.id,
        userText: "偷看进度",
        model: replayModel(),
      }),
    ).rejects.toThrow("没有权限");
  });

  it("越权项目 id 亦被拒", async () => {
    const { student } = await scene();
    await expect(
      runAgentTurn({
        actorId: student.id,
        projectId: "00000000-0000-0000-0000-000000000000",
        userText: "偷看",
        model: replayModel(),
      }),
    ).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
npm test -- tests/agent-orchestrator.test.ts
```
Expected: FAIL（`@/lib/agent/orchestrator` 不存在）。

- [ ] **Step 4: 实现 `src/lib/agent/orchestrator.ts`**

```ts
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { buildTools } from "./tools";
import { buildProjectSnapshot } from "./snapshot";
import {
  getOrCreateConversation,
  persistTurn,
  type ToolTraceEntry,
} from "./conversation";
import { getModel } from "./model";

const SYSTEM_PREAMBLE =
  "你是 AgileCampus 的项目管理助手。依据下方项目快照回答；需要明细时调用读工具。仅管理项目，不代做实际工作。";

export async function runAgentTurn(params: {
  actorId: string;
  projectId: string;
  userText: string;
  model?: LanguageModel;
}) {
  const { actorId, projectId, userText, model } = params;

  // 权限收敛：会话创建内部经 getProjectForUser 校验，非成员/不存在一律 ForbiddenError
  const conversation = await getOrCreateConversation(actorId, projectId);
  const snapshot = await buildProjectSnapshot(actorId, projectId);
  const tools = buildTools(actorId, projectId);

  const result = await generateText({
    model: model ?? getModel(),
    system: `${SYSTEM_PREAMBLE}\n\n${snapshot}`,
    tools,
    stopWhen: stepCountIs(5),
    messages: [{ role: "user", content: userText }],
  });

  // 工具轨迹：逐步展开 toolCalls 与对应 toolResults
  const toolTrace: ToolTraceEntry[] = result.steps.flatMap((step) =>
    step.toolCalls.map((tc, i) => ({
      toolName: tc.toolName,
      input: tc.input,
      output: step.toolResults[i]?.output,
    })),
  );

  await persistTurn(conversation.id, userText, result.text, toolTrace);

  return { conversationId: conversation.id, text: result.text, toolTrace };
}
```

注（版本敏感的唯一点）：mock fixture 的 `content` 项与 `result.steps[].toolCalls[].input/.toolName`、`toolResults[].output` 字段名以本地安装的 `ai` 包 `LanguageModelV2Content` / `StepResult` 类型为准。若 tsc 报字段不符（如 `input`↔`args`、`output`↔`result`），依类型微调 fixture 与展开代码——这是全图唯一需按安装版本核对处。

- [ ] **Step 5: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add src/lib/agent/model.ts src/lib/agent/orchestrator.ts tests/agent-orchestrator.test.ts
git commit -m "feat: Agent 编排层 runAgentTurn——多步工具循环+落库（replay 验证）"
```
Expected: 全量 61 passed（58+3）。

---

### Task 7: route 薄壳 + 对话面板 + 挂载

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/(app)/projects/[projectId]/chat-panel.tsx`
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`（挂载 ChatPanel + 载入历史消息）

- [ ] **Step 1: 创建 `src/app/api/chat/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  projectId: z.uuid(),
  userText: z.string().trim().min(1, "请输入内容"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await runAgentTurn({
      actorId: session.user.id,
      projectId: parsed.data.projectId,
      userText: parsed.data.userText,
    });
    return NextResponse.json({ text: result.text, toolTrace: result.toolTrace });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    // DeepSeek 超时/失败等：明示错误，不静默、不自动重试
    const msg = e instanceof Error ? e.message : "对话失败，请重试";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建 `src/app/(app)/projects/[projectId]/chat-panel.tsx`**

```tsx
"use client";

import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel({
  projectId,
  initialMessages,
}: {
  projectId: string;
  initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, userText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "对话失败");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.text }]);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-medium">项目助手</h2>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded p-2 text-sm ${
              m.role === "user" ? "bg-gray-100" : "bg-blue-50"
            }`}
          >
            <span className="mr-2 text-xs text-gray-400">
              {m.role === "user" ? "我" : "助手"}
            </span>
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">向助手提问，如「当前进度如何？」</p>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="问点什么…"
          className="flex-1 rounded border p-2 text-sm"
          disabled={pending}
        />
        <button
          onClick={send}
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "思考中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `page.tsx` 挂载 ChatPanel + 载入历史**

在 `src/app/(app)/projects/[projectId]/page.tsx` 顶部 import 追加（`eq` 若已 import 则复用，勿重复声明）：
```tsx
import { desc } from "drizzle-orm";
import { conversations, messages as messagesTable } from "@/db/schema";
import { ChatPanel } from "./chat-panel";
```

在既有 `Promise.all` 数据装配后、`return` 之前，追加载入该项目最近会话的历史消息：
```tsx
const [latestConv] = await db
  .select({ id: conversations.id })
  .from(conversations)
  .where(eq(conversations.projectId, projectId))
  .orderBy(desc(conversations.createdAt))
  .limit(1);

const history = latestConv
  ? await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, latestConv.id))
      .orderBy(messagesTable.createdAt)
  : [];

const initialMessages = history
  .filter((m) => m.role === "user" || m.role === "assistant")
  .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
```

在返回的 JSX 中（看板 section 之后、`canWrite` 新建任务表单之前）挂载：
```tsx
<ChatPanel projectId={projectId} initialMessages={initialMessages} />
```

- [ ] **Step 4: 验证（薄壳：编译 + 类型 + 构建；真流式演武留待密钥）**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build
```
Expected: tsc 干净、61 tests 全绿、lint 净、build 成——build 路由清单出 `/api/chat`（ƒ Dynamic）。

- [ ] **Step 5: 端到端结构验证（无密钥可验部分）**

```bash
npm run dev   # 另开终端
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' -d '{"projectId":"00000000-0000-0000-0000-000000000000","userText":"hi"}'
# Expected: 401（未带会话 cookie）
```
浏览器访问 `/projects/[projectId]` 应见「项目助手」面板，输入框可编辑。真实一轮问答留待密钥齐备（填 `.env` 的 `DEEPSEEK_API_KEY` 即可，`getModel()` 自动切真 provider）。

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/chat" "src/app/(app)/projects/[projectId]/chat-panel.tsx" "src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat: 对话面板与 /api/chat 薄壳（请求-响应式，鉴权收敛）"
```

---

### Task 8: 收尾——全量回归、文档、备案

**Files:**
- Modify: `README.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: 全量回归**

```bash
npm test && npm run lint && npm run build
```
Expected: 61 tests 全绿、lint 净、build 成（新增 `/api/chat`）。

- [ ] **Step 2: README「主要路由」节补一行 + 「文档」节加图三链接**

主要路由列表追加：
```markdown
- `/api/chat` 项目助手对话（Agent 读工具，POST）
```
文档列表追加：
```markdown
- 图三设计（灵魂·上）：docs/superpowers/specs/2026-07-22-agilecampus-plan3-agent-design.md
```

- [ ] **Step 3: BACKLOG 追加「图三上简化备案」**

```markdown
## 图三上（对话地基）简化备案
- 对话采请求-响应式（generateText 非流式），真流式（useChat + toUIMessageStreamResponse）后置——无密钥时流式无从离线验证
- 每项目一活跃会话（getOrCreateConversation 取最近一条），未做多会话/会话列表
- tool role 消息未独立成行：工具轨迹并入 assistant 消息的 toolCalls jsonb
- DeepSeek 真实调用未演武（离线打通策），密钥齐备后须补真实一轮问答验收
- 快照上限固定 2000 字符、超限整体降级为统计头，未做分段精细裁剪
- 工具执行走底层 lib 各自的权限校验，与编排入口 getProjectForUser 构成轻微重复查询（复用现成 lib，未优化）
```

- [ ] **Step 4: 图三上验收清单（对照设计文档第 5 节）**

1. 两表 schema push 两库成 ✓（Task 2）
2. query_progress / list_tasks 纯函数单测绿（含权限、筛选）✓（Task 3）
3. 快照组装单测绿（含超限降级）✓（Task 4）
4. replay 集成测试：模型调 query_progress → 落库 messages → 出文本 ✓（Task 6）
5. 非成员 runAgentTurn / listConversationMessages 被拒；/api/chat 未登录 401 ✓（Task 5/6/7）
6. `npx tsc --noEmit && npm test && npm run lint && npm run build` 全净
7. （留待密钥）真实 DeepSeek 一轮问答演武——填 `.env` 后走一遍项目助手对话

- [ ] **Step 5: Commit**

```bash
git add README.md docs/BACKLOG.md
git commit -m "docs: 图三上收尾——路由/文档与简化备案"
```

---

## Self-Review（已核）

- **Spec 覆盖**：设计文档五节逐项对应——§1 两表→Task 2；§2 编排层/model/tools/snapshot→Task 3-6；§3 UI/数据流→Task 7（请求-响应式，已备案偏离）；§4 验收边界→各 Task 验证步 + Task 8；§5 验收清单→Task 8 Step 4。
- **占位扫描**：无 TBD/TODO；唯一「版本敏感点」（Task 6 mock fixture 字段名）为诚实的实施核对，非占位——已给出预期形态与回退指引。
- **类型一致**：`runAgentTurn` 返回 `{conversationId, text, toolTrace}` 全程一致；`ToolTraceEntry` 于 conversation.ts 定义、orchestrator.ts 与测试复用；`buildTools`/`queryProgress`/`listTasksFiltered` 签名跨 Task 3/6 一致；`getModel` 返回 `LanguageModel`，`runAgentTurn` 的 `model?: LanguageModel` 匹配。
