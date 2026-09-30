# AgileCampus 作战图三下：四写兵器 + 两段式确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图三上对话地基之上补 MVP 灵魂之下半——四写兵器（create_project / decompose_tasks / update_tasks / plan_sprint）与写操作两段式人工确认：Agent 只产草案不落库，人工确认后经 `/api/chat/commit` 走图二既有 lib 重校验落库，全链路以 replay + 直测离线验证。

**Architecture:** 写工具 `execute` 只产带 `__draft` 标记的草案信封（不落库）；`runAgentTurn` 从 `result.steps` 提取草案返回 `drafts`；前端渲染确认卡片，用户编辑确认后 POST `/api/chat/commit`；`commitDraft` 按 tool 类型 dispatch 到图二 lib（`createProject`/`createTask`/`updateTask`），落库时重施 Zod + 权限（lib 内建）+ `update_tasks` 乐观锁版本校验。落库绝不信任 Agent 输出。

**Tech Stack:** 图三上既有栈（`ai@5` + `@ai-sdk/openai-compatible@1.0.46` + `MockLanguageModelV2`）。无新依赖。

**设计文档：** `docs/superpowers/specs/2026-07-22-agilecampus-plan3b-agent-write-design.md`

**关键实施决策（对设计的精化）：**
- 版本校验需「读时版本」：`update_tasks` 的 `execute` 查任务当前 `updatedAt` 填入草案；为此在图二 `listProjectTasks` 加 `updatedAt` 列。
- `plan_sprint` 仅批量归里程碑+设截止日，**免版本校验**（草案仅含 taskIds，无逐任务版本；低冲突，MVP 可接受，BACKLOG 备案）。

**约定沿用：** `@/`→src、`AppError`/`ForbiddenError`、入口自 `auth()`、`MockLanguageModelV2` 用**函数游标**形式（数组形式在 5.0.218 下跳过 [0]，图三上教训）、测试 `resetDb`+`makeUser`/`scene` 脚手架。

---

## 文件结构总览

```
src/lib/task.ts                    # 改：listProjectTasks 的 select 加 updatedAt 列
src/lib/agent/tools.ts             # 追加四写工具 + WRITE_TOOL_NAMES + draftEnvelope
src/lib/agent/orchestrator.ts      # runAgentTurn 返回增 drafts（提取带 __draft 的 output）
src/lib/agent/commit.ts            # 新：commitDraft(actorId, projectId, tool, draft) dispatch + 版本校验
src/app/api/chat/commit/route.ts   # 新：落库端点薄壳
src/app/(app)/projects/[projectId]/draft-cards.tsx  # 新：四类草案卡片
src/app/(app)/projects/[projectId]/chat-panel.tsx   # 改：assistant 消息挟 drafts、渲染卡片
src/app/(app)/projects/[projectId]/page.tsx         # 改：ChatPanel 传 members/milestones
tests/agent-write-tools.test.ts    # 写工具产草案 + 版本填充
tests/agent-drafts.test.ts         # runAgentTurn 提取 drafts（replay）
tests/agent-commit.test.ts         # commitDraft 落库/权限/版本冲突
```

---

### Task 1: listProjectTasks 加 updatedAt 列（图二 lib 手术式）

**Files:**
- Modify: `src/lib/task.ts`（`listProjectTasks` 的 select）

- [ ] **Step 1: 在 `src/lib/task.ts` 的 `listProjectTasks` select 中追加 updatedAt**

将 `listProjectTasks` 的 `.select({...})` 块内 `assigneeName: users.name,` 之后追加一行：
```ts
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
```

- [ ] **Step 2: 验证不回归**

```bash
docker compose up -d
npx tsc --noEmit && npm test
```
Expected: tsc 干净、59 tests 全绿（多一字段不影响既有断言）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/task.ts
git commit -m "feat: listProjectTasks 暴露 updatedAt（供 Agent 写工具乐观锁）"
```

---

### Task 2: 四写兵器定义（草案信封，TDD）

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Create: `tests/agent-write-tools.test.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-write-tools.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, projects } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { buildTools, WRITE_TOOL_NAMES } from "@/lib/agent/tools";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, project };
}

// AI SDK 的 tool.execute 签名为 (input, options)；测试直调传占位 options
const opts = {} as never;

describe("写工具产草案不落库", () => {
  beforeEach(resetDb);

  it("WRITE_TOOL_NAMES 含四写工具", () => {
    expect(WRITE_TOOL_NAMES).toEqual([
      "create_project",
      "decompose_tasks",
      "update_tasks",
      "plan_sprint",
    ]);
  });

  it("decompose_tasks 产草案信封，且 tasks 表无新行", async () => {
    const { student, project } = await scene();
    const tools = buildTools(student.id, project.id);
    const out = await tools.decompose_tasks.execute!(
      { tasks: [{ title: "撰写问卷" }, { title: "分析数据" }] },
      opts,
    );
    expect(out).toMatchObject({
      __draft: true,
      tool: "decompose_tasks",
      draft: { tasks: [{ title: "撰写问卷" }, { title: "分析数据" }] },
    });
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    expect(rows).toHaveLength(0); // 未落库
  });

  it("create_project 产草案信封，且 projects 表无新行", async () => {
    const { student, project } = await scene();
    const tools = buildTools(student.id, project.id);
    const before = await db.select().from(projects);
    const out = await tools.create_project.execute!(
      { name: "新项目", description: "描述" },
      opts,
    );
    expect(out).toMatchObject({ __draft: true, tool: "create_project", draft: { name: "新项目" } });
    const after = await db.select().from(projects);
    expect(after).toHaveLength(before.length); // 未落库
  });

  it("update_tasks 产草案，为每个 update 填入当前 updatedAt", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const tools = buildTools(student.id, project.id);
    const out = (await tools.update_tasks.execute!(
      { updates: [{ taskId: t.id, patch: { status: "doing" } }] },
      opts,
    )) as { draft: { updates: { taskId: string; updatedAt: string; patch: unknown }[] } };
    expect(out.draft.updates[0].taskId).toBe(t.id);
    expect(typeof out.draft.updates[0].updatedAt).toBe("string"); // 已填版本
    expect(out.draft.updates[0].patch).toEqual({ status: "doing" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-write-tools.test.ts
```
Expected: FAIL（`WRITE_TOOL_NAMES` / 写工具不存在）。

- [ ] **Step 3: 在 `src/lib/agent/tools.ts` 追加**

确认顶部已 import `tool`（from "ai"）、`z`、`listProjectTasks`（图三上已 import 后二者；若 `listProjectTasks` 未 import 则补 `import { listProjectTasks } from "@/lib/task";`）。在文件末尾追加常量与辅助：

```ts
export const WRITE_TOOL_NAMES = [
  "create_project",
  "decompose_tasks",
  "update_tasks",
  "plan_sprint",
] as const;

export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

// 草案信封：写工具 execute 的统一返回形态，供 orchestrator 识别提取
export type DraftEnvelope = { __draft: true; tool: WriteToolName; draft: unknown };

function draftEnvelope(tool: WriteToolName, draft: unknown): DraftEnvelope {
  return { __draft: true, tool, draft };
}
```

然后在 `buildTools` 的 `return { ... }` 中，于 `list_tasks` 之后追加四写工具：

```ts
    create_project: tool({
      description: "拟一个新项目草案（在当前项目所属团队下）。仅产草案，需人工确认后落库。",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      execute: async (input) => draftEnvelope("create_project", input),
    }),
    decompose_tasks: tool({
      description: "把目标/需求拆成任务清单草案。仅产草案，需人工确认后落库。",
      inputSchema: z.object({
        tasks: z.array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            assigneeId: z.string().optional(),
            dueDate: z.string().optional(),
            milestoneId: z.string().optional(),
            priority: z.enum(["low", "medium", "high"]).optional(),
          }),
        ),
      }),
      execute: async (input) => draftEnvelope("decompose_tasks", input),
    }),
    update_tasks: tool({
      description: "拟批量任务变更草案（状态/负责人/截止日/里程碑/优先级/标题）。仅产草案，需人工确认。",
      inputSchema: z.object({
        updates: z.array(
          z.object({
            taskId: z.string(),
            patch: z.object({
              title: z.string().optional(),
              status: z.enum(["todo", "doing", "done"]).optional(),
              assigneeId: z.string().optional(),
              dueDate: z.string().optional(),
              milestoneId: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
            }),
          }),
        ),
      }),
      // 为每个 update 填入当前 updatedAt（乐观锁读时版本），供 commit 比对
      execute: async (input) => {
        const rows = await listProjectTasks(actorId, projectId);
        const versionOf = new Map(rows.map((r) => [r.id, r.updatedAt]));
        const updates = input.updates.map((u) => ({
          taskId: u.taskId,
          updatedAt: versionOf.get(u.taskId)?.toISOString() ?? "",
          patch: u.patch,
        }));
        return draftEnvelope("update_tasks", { updates });
      },
    }),
    plan_sprint: tool({
      description: "把选定任务排入某里程碑并批量设截止日。仅产草案，需人工确认。",
      inputSchema: z.object({
        milestoneId: z.string(),
        taskIds: z.array(z.string()),
        dueDate: z.string(),
      }),
      execute: async (input) => draftEnvelope("plan_sprint", input),
    }),
```

注：`listProjectTasks` 的 `updatedAt` 为 `Date`（Task 1 已加），`.toISOString()` 转字符串存草案。

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-write-tools.test.ts src/lib/agent/tools.ts
git commit -m "feat: Agent 四写兵器——execute 产草案信封不落库（含 update 读时版本）"
```
Expected: 全量 63 passed（59+4）。真跑为准，勿改测试凑数。

---

### Task 3: runAgentTurn 提取 drafts（replay TDD）

**Files:**
- Modify: `src/lib/agent/orchestrator.ts`
- Create: `tests/agent-drafts.test.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-drafts.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
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
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, project };
}

// 函数游标形式（数组形式在 5.0.218 下跳过 [0]，见 BACKLOG 依赖教训）
function replayDecompose() {
  const script = [
    {
      finishReason: "tool-calls" as const,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c1",
          toolName: "decompose_tasks",
          input: JSON.stringify({ tasks: [{ title: "撰写问卷" }, { title: "分析数据" }] }),
        },
      ],
      warnings: [],
    },
    {
      finishReason: "stop" as const,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      content: [{ type: "text" as const, text: "已为你拟了 2 个任务，请确认。" }],
      warnings: [],
    },
  ];
  let cursor = 0;
  return new MockLanguageModelV2({ doGenerate: async () => script[cursor++] });
}

describe("runAgentTurn 提取 drafts", () => {
  beforeEach(resetDb);

  it("模型调 decompose_tasks → drafts 有任务清单、tasks 表仍空", async () => {
    const { student, project } = await scene();
    const result = await runAgentTurn({
      actorId: student.id,
      projectId: project.id,
      userText: "帮我把调研拆成任务",
      model: replayDecompose(),
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].tool).toBe("decompose_tasks");
    expect((result.drafts[0].draft as { tasks: unknown[] }).tasks).toHaveLength(2);

    // 第一段不落库：tasks 表仍空
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-drafts.test.ts
```
Expected: FAIL（`result.drafts` undefined）。

- [ ] **Step 3: 修改 `src/lib/agent/orchestrator.ts`**

顶部 import 补 `DraftEnvelope`：
```ts
import { buildTools, type DraftEnvelope } from "./tools";
```
（原为 `import { buildTools } from "./tools";`，替换之。）

在 `toolTrace` 计算之后、`persistTurn` 之前，追加 drafts 提取，并把 drafts 纳入返回：

```ts
  // 写工具草案：从各步 toolResults 中提取带 __draft 标记的信封
  const drafts: DraftEnvelope[] = result.steps.flatMap((step) =>
    step.toolResults
      .map((tr) => tr.output as unknown)
      .filter(
        (o): o is DraftEnvelope =>
          typeof o === "object" && o !== null && (o as { __draft?: unknown }).__draft === true,
      ),
  );

  await persistTurn(conversation.id, userText, result.text, toolTrace);

  return { conversationId: conversation.id, text: result.text, toolTrace, drafts };
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-drafts.test.ts src/lib/agent/orchestrator.ts
git commit -m "feat: runAgentTurn 提取写工具草案 drafts（第一段不落库）"
```
Expected: 全量 64 passed（63+1）。真跑为准。

---

### Task 4: commit.ts 落库 dispatch + 版本校验（直测 TDD）

**Files:**
- Create: `src/lib/agent/commit.ts`
- Create: `tests/agent-commit.test.ts`

- [ ] **Step 1: 写失败测试 `tests/agent-commit.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, projects } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask, listProjectTasks, updateTask } from "@/lib/task";
import { commitDraft } from "@/lib/agent/commit";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, project };
}

describe("commitDraft — decompose_tasks", () => {
  beforeEach(resetDb);

  it("student 确认拆解草案 → 批量落库", async () => {
    const { student, project } = await scene();
    const r = await commitDraft(student.id, project.id, "decompose_tasks", {
      tasks: [{ title: "甲" }, { title: "乙", priority: "high" }],
    });
    expect(r.committed).toBe(2);
    const rows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    expect(rows).toHaveLength(2);
  });

  it("非成员草案落库被拒", async () => {
    const { outsider, project } = await scene();
    await expect(
      commitDraft(outsider.id, project.id, "decompose_tasks", { tasks: [{ title: "越权" }] }),
    ).rejects.toThrow("没有权限");
  });
});

describe("commitDraft — create_project", () => {
  beforeEach(resetDb);

  it("admin 确认建项目草案 → 落库于同团队", async () => {
    const { owner, team, project } = await scene();
    const r = await commitDraft(owner.id, project.id, "create_project", { name: "新项目" });
    expect(r.committed).toBe(1);
    const rows = await db.select().from(projects).where(eq(projects.teamId, team.id));
    expect(rows.some((p) => p.name === "新项目")).toBe(true);
  });

  it("student 建项目草案落库被拒（仅 admin）", async () => {
    const { student, project } = await scene();
    await expect(
      commitDraft(student.id, project.id, "create_project", { name: "私设" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("commitDraft — update_tasks 版本校验", () => {
  beforeEach(resetDb);

  it("版本一致 → 落库", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const [row] = await listProjectTasks(student.id, project.id);
    const r = await commitDraft(student.id, project.id, "update_tasks", {
      updates: [{ taskId: t.id, updatedAt: row.updatedAt.toISOString(), patch: { status: "doing" } }],
    });
    expect(r.committed).toBe(1);
    expect(r.conflicts).toHaveLength(0);
    const [after] = await listProjectTasks(student.id, project.id);
    expect(after.status).toBe("doing");
  });

  it("版本过期（updatedAt 不符）→ 冲突、不落库", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    await updateTask(student.id, t.id, { status: "done" }); // 令 updatedAt 前移
    const r = await commitDraft(student.id, project.id, "update_tasks", {
      updates: [
        { taskId: t.id, updatedAt: "2000-01-01T00:00:00.000Z", patch: { status: "doing" } },
      ],
    });
    expect(r.committed).toBe(0);
    expect(r.conflicts).toEqual([t.id]);
    const [after] = await listProjectTasks(student.id, project.id);
    expect(after.status).toBe("done"); // 未被覆盖
  });
});

describe("commitDraft — plan_sprint", () => {
  beforeEach(resetDb);

  it("归入里程碑 + 批量设截止日（免版本校验）", async () => {
    const { owner, student, project } = await scene();
    const m = await createMilestone(owner.id, project.id, { title: "冲刺一" });
    const t1 = await createTask(student.id, project.id, { title: "甲" });
    const t2 = await createTask(student.id, project.id, { title: "乙" });
    const r = await commitDraft(student.id, project.id, "plan_sprint", {
      milestoneId: m.id,
      taskIds: [t1.id, t2.id],
      dueDate: "2026-11-30",
    });
    expect(r.committed).toBe(2);
    const rows = await listProjectTasks(student.id, project.id);
    expect(rows.every((x) => x.milestoneId === m.id && x.dueDate === "2026-11-30")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/agent-commit.test.ts
```
Expected: FAIL（`@/lib/agent/commit` 不存在）。

- [ ] **Step 3: 实现 `src/lib/agent/commit.ts`**

```ts
import { z } from "zod";
import { createProject, getProjectForUser } from "@/lib/project";
import { createTask, listProjectTasks, updateTask } from "@/lib/task";
import { ForbiddenError } from "@/lib/errors";
import type { WriteToolName } from "./tools";

const taskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const decomposeSchema = z.object({ tasks: z.array(taskDraftSchema).min(1) });

const patchSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

const updateTasksSchema = z.object({
  updates: z
    .array(z.object({ taskId: z.string(), updatedAt: z.string(), patch: patchSchema }))
    .min(1),
});

const planSprintSchema = z.object({
  milestoneId: z.string(),
  taskIds: z.array(z.string()).min(1),
  dueDate: z.string(),
});

export type CommitResult = { committed: number; conflicts: string[] };

// 落库：绝不信 Agent 输出——入口重校访问权，每类先施 Zod，再走图二 lib（lib 内建权限/归属校验）
export async function commitDraft(
  actorId: string,
  projectId: string,
  tool: WriteToolName,
  draft: unknown,
): Promise<CommitResult> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  switch (tool) {
    case "create_project": {
      const d = createProjectSchema.parse(draft);
      await createProject(actorId, access.project.teamId, d);
      return { committed: 1, conflicts: [] };
    }
    case "decompose_tasks": {
      const d = decomposeSchema.parse(draft);
      for (const t of d.tasks) await createTask(actorId, projectId, t);
      return { committed: d.tasks.length, conflicts: [] };
    }
    case "update_tasks": {
      const d = updateTasksSchema.parse(draft);
      const current = await listProjectTasks(actorId, projectId);
      const versionOf = new Map(current.map((r) => [r.id, r.updatedAt.toISOString()]));
      const conflicts: string[] = [];
      let committed = 0;
      for (const u of d.updates) {
        if (versionOf.get(u.taskId) !== u.updatedAt) {
          conflicts.push(u.taskId);
          continue;
        }
        await updateTask(actorId, u.taskId, u.patch);
        committed++;
      }
      return { committed, conflicts };
    }
    case "plan_sprint": {
      const d = planSprintSchema.parse(draft);
      for (const id of d.taskIds)
        await updateTask(actorId, id, { milestoneId: d.milestoneId, dueDate: d.dueDate });
      return { committed: d.taskIds.length, conflicts: [] };
    }
  }
}
```

注：`update_tasks` 版本比对——`listProjectTasks` 已含 `updatedAt`（Task 1）。非成员 `commitDraft` 入口即 `ForbiddenError`；越角色（如 student 建项目）由 `createProject` 内 `requireTeamRole(["admin"])` 抛出。`plan_sprint` 免版本校验（备案）。

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/agent-commit.test.ts src/lib/agent/commit.ts
git commit -m "feat: commitDraft 落库 dispatch——四路复用图二 lib + update 乐观锁"
```
Expected: 全量 72 passed（64+8）。真跑为准。

---

### Task 5: /api/chat/commit 落库端点（薄壳）

**Files:**
- Create: `src/app/api/chat/commit/route.ts`

- [ ] **Step 1: 创建 `src/app/api/chat/commit/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { commitDraft } from "@/lib/agent/commit";
import { WRITE_TOOL_NAMES } from "@/lib/agent/tools";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  projectId: z.uuid(),
  tool: z.enum(WRITE_TOOL_NAMES),
  draft: z.unknown(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await commitDraft(
      session.user.id,
      parsed.data.projectId,
      parsed.data.tool,
      parsed.data.draft,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "草案格式无效" }, { status: 400 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/chat/commit] 落库失败:", e);
    return NextResponse.json({ error: "落库失败，请重试" }, { status: 500 });
  }
}
```

- [ ] **Step 2: 验证（薄壳：编译+类型+构建+鉴权）**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build
npm run dev &
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/chat/commit \
  -H 'Content-Type: application/json' -d '{"projectId":"00000000-0000-0000-0000-000000000000","tool":"decompose_tasks","draft":{"tasks":[]}}'
# Expected: 401（无会话 cookie）
pkill -f "next dev"
```
Expected: tsc 净、测试全绿、lint 净、build 出 `/api/chat/commit`、curl 401。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/commit/route.ts
git commit -m "feat: /api/chat/commit 落库端点薄壳（鉴权收敛）"
```

---

### Task 6: 确认卡片 UI + chat-panel 集成

**Files:**
- Create: `src/app/(app)/projects/[projectId]/draft-cards.tsx`
- Modify: `src/app/(app)/projects/[projectId]/chat-panel.tsx`
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`

- [ ] **Step 1: 创建 `src/app/(app)/projects/[projectId]/draft-cards.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Draft = { tool: string; draft: unknown };
type Option = { id: string; name: string };

// 提交一个草案到落库端点，返回错误消息（成功为 null）
async function commit(projectId: string, tool: string, draft: unknown): Promise<string | null> {
  const res = await fetch("/api/chat/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, tool, draft }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return data.error ?? "落库失败";
  if (Array.isArray(data.conflicts) && data.conflicts.length > 0)
    return `有 ${data.conflicts.length} 项因他人改动未落库，请刷新后重试`;
  return null;
}

function CardShell({
  title,
  onConfirm,
  children,
}: {
  title: string;
  onConfirm: () => Promise<string | null>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (state === "done")
    return (
      <div className="rounded border border-green-300 bg-green-50 p-2 text-xs text-green-700">
        {title}：已落库 ✓
      </div>
    );

  return (
    <div className="space-y-2 rounded border bg-amber-50 p-2 text-sm">
      <p className="text-xs font-medium text-amber-700">待确认：{title}</p>
      {children}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          setErr(null);
          const e = await onConfirm();
          if (e) {
            setErr(e);
            setState("idle");
          } else {
            setState("done");
            router.refresh();
          }
        }}
        className="rounded bg-black px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        {state === "pending" ? "落库中…" : "确认落库"}
      </button>
    </div>
  );
}

export function DraftCards({
  projectId,
  drafts,
  members,
  milestones,
}: {
  projectId: string;
  drafts: Draft[];
  members: Option[];
  milestones: Option[];
}) {
  return (
    <div className="mt-2 space-y-2">
      {drafts.map((d, i) => (
        <DraftCard key={i} projectId={projectId} draft={d} members={members} milestones={milestones} />
      ))}
    </div>
  );
}

function DraftCard({
  projectId,
  draft,
  members,
  milestones,
}: {
  projectId: string;
  draft: Draft;
  members: Option[];
  milestones: Option[];
}) {
  const [data, setData] = useState<Record<string, unknown>>(draft.draft as Record<string, unknown>);

  if (draft.tool === "create_project") {
    const d = data as { name?: string; description?: string; startDate?: string; endDate?: string };
    return (
      <CardShell title="创建项目" onConfirm={() => commit(projectId, "create_project", d)}>
        <input
          value={d.name ?? ""}
          onChange={(e) => setData({ ...d, name: e.target.value })}
          placeholder="项目名称"
          className="w-full rounded border p-1 text-xs"
        />
        <textarea
          value={d.description ?? ""}
          onChange={(e) => setData({ ...d, description: e.target.value })}
          placeholder="描述"
          className="w-full rounded border p-1 text-xs"
          rows={2}
        />
        <div className="flex gap-1">
          <input type="date" value={d.startDate ?? ""} onChange={(e) => setData({ ...d, startDate: e.target.value })} className="rounded border p-1 text-xs" />
          <input type="date" value={d.endDate ?? ""} onChange={(e) => setData({ ...d, endDate: e.target.value })} className="rounded border p-1 text-xs" />
        </div>
      </CardShell>
    );
  }

  if (draft.tool === "decompose_tasks") {
    const d = data as {
      tasks: { title: string; assigneeId?: string; priority?: string; dueDate?: string; milestoneId?: string }[];
    };
    const setTask = (idx: number, patch: object) =>
      setData({ ...d, tasks: d.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });
    return (
      <CardShell title={`拆解任务（${d.tasks.length}）`} onConfirm={() => commit(projectId, "decompose_tasks", d)}>
        {d.tasks.map((t, idx) => (
          <div key={idx} className="flex flex-wrap gap-1 border-b pb-1">
            <input value={t.title} onChange={(e) => setTask(idx, { title: e.target.value })} className="flex-1 rounded border p-1 text-xs" />
            <select value={t.assigneeId ?? ""} onChange={(e) => setTask(idx, { assigneeId: e.target.value || undefined })} className="rounded border p-1 text-xs">
              <option value="">未分配</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select value={t.priority ?? "medium"} onChange={(e) => setTask(idx, { priority: e.target.value })} className="rounded border p-1 text-xs">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
            <input type="date" value={t.dueDate ?? ""} onChange={(e) => setTask(idx, { dueDate: e.target.value || undefined })} className="rounded border p-1 text-xs" />
            <button type="button" onClick={() => setData({ ...d, tasks: d.tasks.filter((_, i) => i !== idx) })} className="text-xs text-red-600">
              删
            </button>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "update_tasks") {
    const d = data as { updates: { taskId: string; updatedAt: string; patch: Record<string, unknown> }[] };
    return (
      <CardShell title={`批量变更（${d.updates.length}）`} onConfirm={() => commit(projectId, "update_tasks", d)}>
        {d.updates.map((u, idx) => (
          <div key={idx} className="border-b pb-1 text-xs">
            <span className="text-gray-500">任务 {u.taskId.slice(0, 8)}…：</span>
            <span>{JSON.stringify(u.patch)}</span>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "plan_sprint") {
    const d = data as { milestoneId: string; taskIds: string[]; dueDate: string };
    return (
      <CardShell title={`排期（${d.taskIds.length} 任务）`} onConfirm={() => commit(projectId, "plan_sprint", d)}>
        <div className="flex flex-wrap gap-1 text-xs">
          <select value={d.milestoneId} onChange={(e) => setData({ ...d, milestoneId: e.target.value })} className="rounded border p-1">
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input type="date" value={d.dueDate} onChange={(e) => setData({ ...d, dueDate: e.target.value })} className="rounded border p-1" />
          <span className="text-gray-500">{d.taskIds.length} 个任务</span>
        </div>
      </CardShell>
    );
  }

  return null;
}
```

- [ ] **Step 2: 完整替换 `src/app/(app)/projects/[projectId]/chat-panel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DraftCards, type Draft } from "./draft-cards";

type Option = { id: string; name: string };
type Msg = { role: "user" | "assistant"; content: string; drafts?: Draft[] };

export function ChatPanel({
  projectId,
  initialMessages,
  members,
  milestones,
}: {
  projectId: string;
  initialMessages: Msg[];
  members: Option[];
  milestones: Option[];
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
      setMessages((m) => [...m, { role: "assistant", content: data.text, drafts: data.drafts }]);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-medium">项目助手</h2>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i}>
            <div className={`rounded p-2 text-sm ${m.role === "user" ? "bg-gray-100" : "bg-blue-50"}`}>
              <span className="mr-2 text-xs text-gray-400">{m.role === "user" ? "我" : "助手"}</span>
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
            {m.drafts && m.drafts.length > 0 && (
              <DraftCards projectId={projectId} drafts={m.drafts} members={members} milestones={milestones} />
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">向助手提问，如「当前进度如何？」或「把调研拆成任务」</p>
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
        <button onClick={send} disabled={pending} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "思考中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 修改 `src/app/(app)/projects/[projectId]/page.tsx` 的 ChatPanel 挂载**

将既有 `<ChatPanel projectId={projectId} initialMessages={initialMessages} />` 替换为：
```tsx
<ChatPanel
  projectId={projectId}
  initialMessages={initialMessages}
  members={members}
  milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
/>
```
（`members` 在图三上已装配为 `{id, name}[]`；`projectMilestones` 为里程碑数组，映射为 `{id, name}`。若 page 中变量名不同则适配。）

- [ ] **Step 4: 验证并提交**

```bash
npx tsc --noEmit && npm test && npm run lint && npm run build
git add "src/app/(app)/projects/[projectId]/draft-cards.tsx" "src/app/(app)/projects/[projectId]/chat-panel.tsx" "src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat: 四类草案确认卡片与 chat-panel 集成（确认落库刷看板）"
```
Expected: tsc 净、测试全绿、lint 净、build 成。

---

### Task 7: 收尾——全量回归、文档、备案

**Files:**
- Modify: `README.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: 全量回归**

```bash
npm test && npm run lint && npm run build
```
Expected: 全绿、build 出 `/api/chat/commit`。

- [ ] **Step 2: README「主要路由」节补一行 + 「文档」节加图三下链接**

主要路由追加：
```markdown
- `/api/chat/commit` Agent 写操作草案落库（两段式确认，POST）
```
文档追加：
```markdown
- 图三设计（灵魂·下）：docs/superpowers/specs/2026-07-22-agilecampus-plan3b-agent-write-design.md
- 作战图三下（四写兵器）：docs/superpowers/plans/2026-07-22-agilecampus-plan3b-agent-write-tools.md
```

- [ ] **Step 3: BACKLOG 追加「图三下简化备案」**

```markdown
## 图三下（四写兵器）简化备案
- plan_sprint 免版本校验（草案仅 taskIds 无逐任务 updatedAt）——批量归里程碑+设截止日，低冲突，MVP 可接受
- update_tasks 乐观锁比对 updatedAt.toISOString()；同一毫秒两写理论上仍可能漏检，概率极低
- 草案不入库持久化：仅随 assistant 消息 toolCalls 留痕 + 前端态；页面刷新后未落库的草案卡片消失（需重新对话）
- 确认卡片可编辑聚焦核心字段：update_tasks 卡仅展示 patch（不可逐字段改）
- DeepSeek 真实「拆任务→确认→落库」演武待密钥
```

- [ ] **Step 4: 验收清单（对照设计文档第 6 节）**

1. 四写工具 execute 产草案且不落库 ✓（Task 2）
2. replay：decompose_tasks → drafts 有、tasks 表空 ✓（Task 3）
3. commitDraft 四路正确落库 ✓（Task 4）
4. 越权草案落库被拒（非成员/越角色）✓（Task 4）
5. update 版本冲突被拒、提示刷新 ✓（Task 4）
6. 确认卡片四类渲染+确认落库+router.refresh ✓（Task 6）
7. `npx tsc --noEmit && npm test && npm run lint && npm run build` 全净
8. （留待密钥）真实 DeepSeek 演武

- [ ] **Step 5: Commit**

```bash
git add README.md docs/BACKLOG.md
git commit -m "docs: 图三下收尾——路由/文档与简化备案"
```

---

## Self-Review（已核）

- **Spec 覆盖**：设计六节逐项对应——§1 两段式→Task 2/3/4/5；§2 四工具草案与落库→Task 2（草案）+Task 4（落库）；§3 UI→Task 6；§4 测试→各 Task 测试步；§5/§6 验收→Task 7。版本校验精化（listProjectTasks 加 updatedAt）落 Task 1。
- **占位扫描**：无 TBD/TODO；测试代码完整；plan_sprint 免版本校验为明示决策非占位。
- **类型一致**：`DraftEnvelope`/`WriteToolName`/`WRITE_TOOL_NAMES`（Task 2）→ orchestrator 提取（Task 3）→ commit dispatch（Task 4）→ route enum（Task 5）→ 卡片 tool 分派（Task 6）全程一致；`commitDraft` 返回 `{committed, conflicts}` 跨 Task 4/5/6 一致；`listProjectTasks` 加的 `updatedAt`（Task 1）被 tools update_tasks（Task 2）与 commit 版本校验（Task 4）共用。
