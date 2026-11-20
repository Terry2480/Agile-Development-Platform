# AgileCampus 作战图四：任务详情增强 + 跨项目总览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 为任务补充「描述内容 / 完成情况 / 后置任务关联」三项细化（A），并新增一个跨团队「所有项目」总览入口（B）。

**Architecture:** 沿用既有分层。A：`tasks` 加 `completionNote` 列 + 新建 `task_dependencies` 表（前置→后置，简单关联+防直接循环，不强制阻断）；`lib/task.ts` 白名单加字段 + 依赖 CRUD；`actions.ts` 表单 schema 扩展；`new-task-form`/`task-card` UI 暴露描述、完成情况、后置任务选择与展示。B：`lib/project.ts` 加 `listMyProjects(userId)` 跨团队聚合 + 任务统计；新增 `/projects` 总览页 + 顶栏入口。

**Tech Stack:** 既有栈（Next.js 16 · Drizzle · Postgres · Vitest），无新依赖。

**设计依据：** 已对齐决策——后置任务取「简单关联+展示，防直接循环，不强制阻断执行」（陛下选）；`description`（图二已有字段，仅 UI 暴露）；`completionNote` 新字段；B 总览为跨团队项目列表+任务统计（调研首推，无需新表）。

**约定沿用：** `@/`→src、`AppError`/`ForbiddenError`、入口自 `auth()`、`resetDb`+`makeUser`/`scene`、美化后用 `.ac-card`/`.ac-field`/`.ac-btn` 类、`text-ink`/`text-ink-soft`/`text-ink-faint` 语义色。

---

## 文件结构总览

```
src/db/schema.ts                     # tasks 加 completionNote；新建 task_dependencies 表
tests/helpers.ts                     # resetDb TRUNCATE 加 task_dependencies
src/lib/task.ts                      # updateTask 白名单加 completionNote；新增依赖 CRUD；listProjectTasks 补两列
src/lib/project.ts                   # 新增 listMyProjects(actorId)
src/app/(app)/projects/[projectId]/actions.ts       # create/update schema 加 description/completionNote/successorIds
src/app/(app)/projects/[projectId]/new-task-form.tsx # 加 description
src/app/(app)/projects/[projectId]/task-card.tsx     # 加 description/completionNote/后置任务
src/app/(app)/projects/[projectId]/board.tsx         # BoardTask 加字段 + 透传 allTasks/dependencies
src/app/(app)/projects/[projectId]/page.tsx          # 装配 dependencies + allTasks 传入
src/app/(app)/projects/page.tsx      # 新：跨项目总览页
src/app/(app)/layout.tsx             # 顶栏加「所有项目」入口
tests/task-detail.test.ts            # completionNote + 依赖 CRUD + 防循环
tests/my-projects.test.ts            # listMyProjects 聚合与隔离
```

---

### Task 1: Schema — completionNote + task_dependencies

**Files:** Modify `src/db/schema.ts`, `tests/helpers.ts`

- [ ] **Step 1:** `src/db/schema.ts` 的 `tasks` 表定义中，在 `description: text("description"),` 之后追加：
```ts
    completionNote: text("completion_note"),
```

- [ ] **Step 2:** 文件末尾追加依赖表：
```ts
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dep_pair_unique").on(t.predecessorId, t.successorId),
    index("task_dep_predecessor_idx").on(t.predecessorId),
  ],
);
```
（`uniqueIndex`、`index`、`timestamp`、`uuid`、`text` 均已在文件顶部 import。）

- [ ] **Step 3:** `tests/helpers.ts` 的 TRUNCATE 最前面加 `task_dependencies`（子表在前）：
```ts
    sql`TRUNCATE task_dependencies, messages, conversations, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
```

- [ ] **Step 4:** push 两库 + 验证：
```bash
docker compose up -d
npm run db:push && npm run db:push:test
npx tsc --noEmit && npm test
```
Expected: 两库 push 成、tsc 净、71 tests 不回归。

- [ ] **Step 5:** Commit
```bash
git add src/db/schema.ts tests/helpers.ts
git commit -m "feat: schema——tasks.completionNote 与 task_dependencies 表"
```

---

### Task 2: lib/task.ts — completionNote 白名单 + 依赖 CRUD（TDD）

**Files:** Create `tests/task-detail.test.ts`; Modify `src/lib/task.ts`

- [ ] **Step 1:** 写失败测试 `tests/task-detail.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  createTask,
  updateTask,
  setTaskSuccessors,
  listProjectDependencies,
} from "@/lib/task";
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

describe("completionNote", () => {
  beforeEach(resetDb);
  it("可写入完成情况", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    const u = await updateTask(student.id, t.id, {
      status: "done",
      completionNote: "已按计划完成，附实验数据",
    });
    expect(u.status).toBe("done");
    expect(u.completionNote).toBe("已按计划完成，附实验数据");
  });
});

describe("后置任务关联", () => {
  beforeEach(resetDb);
  it("设置并列出后置任务", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const c = await createTask(student.id, project.id, { title: "丙" });
    await setTaskSuccessors(student.id, a.id, [b.id, c.id]);
    const deps = await listProjectDependencies(student.id, project.id);
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.successorId).sort()).toEqual([b.id, c.id].sort());
    expect(deps.every((d) => d.predecessorId === a.id)).toBe(true);
  });

  it("重设覆盖旧关联", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const c = await createTask(student.id, project.id, { title: "丙" });
    await setTaskSuccessors(student.id, a.id, [b.id]);
    await setTaskSuccessors(student.id, a.id, [c.id]);
    const deps = await listProjectDependencies(student.id, project.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].successorId).toBe(c.id);
  });

  it("防直接循环：后置不可指向自身或已是其前置者", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    await expect(setTaskSuccessors(student.id, a.id, [a.id])).rejects.toThrow("循环");
    await setTaskSuccessors(student.id, b.id, [a.id]); // b→a
    await expect(setTaskSuccessors(student.id, a.id, [b.id])).rejects.toThrow("循环"); // a→b 成环
  });

  it("后置任务须属同项目", async () => {
    const { owner, team, student, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const a = await createTask(student.id, project.id, { title: "甲" });
    const x = await createTask(owner.id, other.id, { title: "外部" });
    await expect(setTaskSuccessors(student.id, a.id, [x.id])).rejects.toThrow("不属于该项目");
  });

  it("非成员被拒", async () => {
    const { outsider, student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    await expect(setTaskSuccessors(outsider.id, a.id, [])).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2:** 运行确认失败：`npm test -- tests/task-detail.test.ts` — Expected FAIL（`setTaskSuccessors` 等不存在）。

- [ ] **Step 3:** 修改 `src/lib/task.ts`：
  (a) 顶部 import 追加 `taskDependencies`：
```ts
import {
  milestones,
  tasks,
  taskDependencies,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
```
  (b) `updateTask` 的 `patch` 类型加 `completionNote?: string | null;`，并在白名单 `.set({...})` 中追加一行（紧随 priority 之后）：
```ts
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
```
  (c) `listProjectTasks` 的 `.select({...})` 中，`assigneeName: users.name,`（或 updatedAt 行）之后补两列：
```ts
      description: tasks.description,
      completionNote: tasks.completionNote,
```
  (d) 文件末尾追加依赖 CRUD：
```ts
// 设置 predecessor 的后置任务（先删旧再插新）。简单关联：仅防直接成环，不强制阻断执行。
export async function setTaskSuccessors(
  actorId: string,
  predecessorId: string,
  successorIds: string[],
) {
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, pred.projectId);

  for (const sid of successorIds) {
    if (sid === predecessorId) throw new AppError("后置任务不可构成循环");
    const [s] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, sid));
    if (!s || s.projectId !== pred.projectId)
      throw new AppError("后置任务不属于该项目");
    // 防直接成环：若 sid→predecessor 已存在，则 predecessor→sid 成环
    const [back] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, sid),
          eq(taskDependencies.successorId, predecessorId),
        ),
      );
    if (back) throw new AppError("后置任务不可构成循环");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.predecessorId, predecessorId));
    if (successorIds.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(successorIds.map((sid) => ({ predecessorId, successorId: sid })));
    }
  });
}

export async function listProjectDependencies(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      predecessorId: taskDependencies.predecessorId,
      successorId: taskDependencies.successorId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(tasks.projectId, projectId));
}
```
  注：`and` 已在 task.ts 顶部 import（现有 `import { and, eq, sql } from "drizzle-orm";`）。`requireTaskWrite`/`requireProjectAccess` 为文件内既有私有函数。

- [ ] **Step 4:** 运行通过 + 提交：
```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/task-detail.test.ts src/lib/task.ts
git commit -m "feat: 任务 completionNote 白名单 + 后置任务依赖 CRUD（防直接循环）"
```
Expected: 全量约 78 passed（71+7），真跑为准。

---

### Task 3: lib/project.ts — listMyProjects（TDD）

**Files:** Create `tests/my-projects.test.ts`; Modify `src/lib/project.ts`

- [ ] **Step 1:** 写失败测试 `tests/my-projects.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listMyProjects } from "@/lib/project";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

describe("listMyProjects", () => {
  beforeEach(resetDb);

  it("聚合我所在全部团队的项目，含团队名与任务统计", async () => {
    const owner = await makeUser("owner@example.com");
    const t1 = await createTeam(owner.id, "甲组");
    const t2 = await createTeam(owner.id, "乙组");
    const p1 = await createProject(owner.id, t1.id, { name: "项目一" });
    await createProject(owner.id, t2.id, { name: "项目二" });
    await createTask(owner.id, p1.id, { title: "任务A" });
    await createTask(owner.id, p1.id, { title: "任务B" });

    const list = await listMyProjects(owner.id);
    expect(list).toHaveLength(2);
    const one = list.find((p) => p.name === "项目一")!;
    expect(one.teamName).toBe("甲组");
    expect(one.taskTotal).toBe(2);
    expect(one.doneCount).toBe(0);
  });

  it("不含我未加入团队的项目", async () => {
    const owner = await makeUser("owner@example.com");
    const other = await makeUser("other@example.com");
    const mine = await createTeam(owner.id, "我的组");
    const theirs = await createTeam(other.id, "别人的组");
    await createProject(owner.id, mine.id, { name: "我的项目" });
    await createProject(other.id, theirs.id, { name: "别人的项目" });

    const list = await listMyProjects(owner.id);
    expect(list.map((p) => p.name)).toEqual(["我的项目"]);
  });
});
```

- [ ] **Step 2:** 运行确认失败：`npm test -- tests/my-projects.test.ts` — Expected FAIL（`listMyProjects` 不存在）。

- [ ] **Step 3:** `src/lib/project.ts`：
  (a) 顶部 import 补齐（现有 `import { desc, eq } from "drizzle-orm";` → 加 `inArray, sql`；schema import 加 `teamMembers, teams, tasks`；`and` 若未用可不加）：
```ts
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { milestones, projects, teamMembers, teams, tasks } from "@/db/schema";
```
  （保留文件原有其余 import，如 errors、team 的函数。）
  (b) 文件末尾追加：
```ts
// 跨团队聚合：我所在全部团队的项目 + 团队名 + 任务统计
export async function listMyProjects(actorId: string) {
  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, actorId));
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return [];

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      teamId: projects.teamId,
      teamName: teams.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .where(inArray(projects.teamId, teamIds))
    .orderBy(desc(projects.createdAt));

  if (rows.length === 0) return [];

  const stats = await db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      inArray(
        tasks.projectId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(tasks.projectId, tasks.status);

  return rows.map((p) => {
    const mine = stats.filter((s) => s.projectId === p.id);
    const total = mine.reduce((n, s) => n + s.count, 0);
    const doneCount = mine.find((s) => s.status === "done")?.count ?? 0;
    return { ...p, taskTotal: total, doneCount };
  });
}
```

- [ ] **Step 4:** 运行通过 + 提交：
```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/my-projects.test.ts src/lib/project.ts
git commit -m "feat: listMyProjects——跨团队项目聚合与任务统计"
```
Expected: 全量约 80 passed（78+2），真跑为准。

---

### Task 4: actions.ts — 表单 schema 扩展

**Files:** Modify `src/app/(app)/projects/[projectId]/actions.ts`

先读该文件，了解现有 `createTaskAction` / `updateTaskAction` 的 zod schema 与 try/catch 结构，再做以下追加（保持既有错误映射风格）：

- [ ] **Step 1:** `createTaskAction` 的 zod schema 加 `description: z.string().trim().optional()`，并把它并入传给 `createTask` 的 input（`createTask` 已支持 description）。

- [ ] **Step 2:** `updateTaskAction`：
  - zod schema 加：`description: z.string().trim().optional()`、`completionNote: z.string().trim().optional()`。
  - **successorIds 传法（定为此法）**：UI 用 `<select multiple name="successorIds">`，服务端用 `formData.getAll("successorIds")` 取字符串数组（每项为 uuid）。故在 action 内于 `Object.fromEntries` 之外单独取 `const successorIds = formData.getAll("successorIds").map(String);`，并对每项 `z.uuid()` 校验（非法则忽略该项或返错，取忽略非法项即可）。
  - 把 `description`/`completionNote` 并入 `updateTask` 的 patch；调用 `updateTask` 之后（成功后）再调 `setTaskSuccessors(session.user.id, taskId, successorIds)`（即便空数组也调，用于清空）。捕获 `AppError`→400、`ForbiddenError`→403，沿用既有风格。
  - 顶部 import 补 `setTaskSuccessors`（并入现有 `@/lib/task` import）。

- [ ] **Step 3:** 验证 + 提交：
```bash
npx tsc --noEmit && npm test && npm run lint
git add "src/app/(app)/projects/[projectId]/actions.ts"
git commit -m "feat: 任务 action 扩展——描述/完成情况/后置任务"
```
Expected: tsc 净、测试不回归、lint 净。

---

### Task 5: 任务卡 + 新建表单 UI（描述/完成情况/后置任务）

**Files:** Modify `new-task-form.tsx`、`task-card.tsx`、`board.tsx`、`page.tsx`

先读四文件了解现状（美化后用 `.ac-field`/`.ac-card`；`BoardTask` 类型在 `board.tsx`；`page.tsx` 已装配 `projectTasks`/`projectMilestones`/`members`）。

- [ ] **Step 1:** `new-task-form.tsx`：在标题 input 之后加描述框：
```tsx
<textarea name="description" placeholder="任务描述（可选）" rows={2} className="ac-field" />
```

- [ ] **Step 2:** `board.tsx` 的 `BoardTask` 类型加字段 `description: string | null; completionNote: string | null;`；Board props 增 `allTasks: { id: string; title: string }[]` 与 `dependencies: { predecessorId: string; successorId: string }[]`，经 Board→Column→TaskCard 透传（沿用图三下 members/milestones 透传方式）。

- [ ] **Step 3:** `task-card.tsx`：
  (a) 正文（标题下、元信息上）展示描述与完成情况：
```tsx
{task.description && <p className="mt-1 text-xs text-ink-soft line-clamp-2">{task.description}</p>}
{task.status === "done" && task.completionNote && (
  <p className="mt-1 rounded bg-done/10 px-2 py-1 text-xs text-done">完成情况：{task.completionNote}</p>
)}
```
  展示后置任务：`const successorTitles = dependencies.filter(d=>d.predecessorId===task.id).map(d=>allTasks.find(t=>t.id===d.successorId)?.title).filter(Boolean);`
```tsx
{successorTitles.length > 0 && (
  <p className="mt-1 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>
)}
```
  (b) 编辑态表单加：描述 textarea（name="description"）、完成情况 textarea（name="completionNote"）、后置任务多选 `<select multiple name="successorIds" className="ac-field">`（options 为 `allTasks` 排除自身，`defaultValue` 为当前 successors 的 id 数组）。控件用 `.ac-field`。TaskCard props 增 `allTasks`、`dependencies`。

- [ ] **Step 4:** `page.tsx`：`import { listProjectDependencies } from "@/lib/task";`，在 `Promise.all` 中加载 `listProjectDependencies(session.user.id, projectId)`；`projectTasks` 的 map 补 `description`/`completionNote`（listProjectTasks Task 2 已 select 之）；Board 传参加 `allTasks={projectTasks.map(t=>({id:t.id,title:t.title}))}`、`dependencies={dependencies}`。

- [ ] **Step 5:** 验证 + 提交：
```bash
npx tsc --noEmit && npm test && npm run lint && npm run build
git add "src/app/(app)/projects/[projectId]"
git commit -m "feat: 任务卡与表单——描述/完成情况/后置任务关联"
```
Expected: 全绿、build 成。

---

### Task 6: 跨项目总览页 + 顶栏入口

**Files:** Create `src/app/(app)/projects/page.tsx`; Modify `src/app/(app)/layout.tsx`

- [ ] **Step 1:** 创建 `src/app/(app)/projects/page.tsx`：
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listMyProjects(session.user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink">所有项目</h1>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="ac-card flex items-center justify-between p-4">
            <div>
              <Link href={`/projects/${p.id}`} className="font-medium text-primary hover:underline">
                {p.name}
              </Link>
              <span className="ml-2 text-xs text-ink-faint">{p.teamName}</span>
              <span className="ml-2 text-xs text-ink-soft">{p.status}</span>
            </div>
            <div className="text-xs text-ink-soft">
              任务 {p.doneCount}/{p.taskTotal} 完成
            </div>
          </li>
        ))}
        {projects.length === 0 && (
          <li className="text-sm text-ink-soft">暂无项目——先在团队中创建。</li>
        )}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2:** `src/app/(app)/layout.tsx` 顶栏加导航：读该文件，在品牌名旁加 `<Link href="/projects">所有项目</Link>` 与 `<Link href="/teams">我的团队</Link>`，用 `text-sm text-ink-soft hover:text-primary` 风格，保持顶栏布局协调。

- [ ] **Step 3:** 验证 + 提交：
```bash
npx tsc --noEmit && npm test && npm run lint && npm run build
git add "src/app/(app)/projects/page.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat: 跨项目总览页 /projects + 顶栏入口"
```
Expected: 全绿、build 出 `/projects`（区别于 `/projects/[projectId]`）。

---

### Task 7: 收尾——回归、文档、备案、演示

**Files:** Modify `README.md`、`docs/BACKLOG.md`

- [ ] **Step 1:** 全量回归 `npm test && npm run lint && npm run build`。
- [ ] **Step 2:** README「主要路由」加 `- /projects 所有项目总览（跨团队）`；「文档」加图四作战图链接。
- [ ] **Step 3:** BACKLOG 追加图四备案：
```markdown
## 图四（任务增强+总览）简化备案
- 后置任务仅防直接成环（A↔B），未做间接环（A→B→C→A）检测——简单关联，不强制阻断执行
- 完成情况(completionNote)仅在编辑态填写，未做「拖入已完成时弹窗提示补充」的引导交互
- 跨项目总览为列表+任务统计，未含管理员整体看板泳道/甘特图（留后续「图五·管理视图」）
- listMyProjects 对 admin/teacher/student 一视同仁（无项目级成员表，沿图二备案）
```
- [ ] **Step 4:** 端到端演示（Playwright，demo 账号）：任务加描述→完成时填完成情况→设后置任务→卡片展示；顶栏「所有项目」跨团队总览。截图。
- [ ] **Step 5:** Commit `docs: 图四收尾——路由/文档与备案`。

---

## Self-Review（已核）
- **覆盖**：A 描述→Task 1(字段已有)/5(UI)；完成情况→Task 1/2/5；后置任务→Task 1/2/4/5。B 聚合→Task 3；总览页+入口→Task 6。
- **占位**：无 TBD；successorIds 传法已定为 `<select multiple>`+`getAll`（Task 4/5 一致）。
- **类型一致**：`setTaskSuccessors`/`listProjectDependencies`（Task 2）→ action（Task 4）→ page/board/card（Task 5）一致；`BoardTask` 加 `description`/`completionNote`（Task 5）与 `listProjectTasks` select（Task 2）对齐；`listMyProjects` 返回 `{id,name,status,teamId,teamName,createdAt,taskTotal,doneCount}`（Task 3）与总览页（Task 6）一致。
