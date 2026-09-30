# AgileCampus 一期 · 标签与视图 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AgileCampus 引入团队级共享标签、项目页筛选栏与看板多维度分组（各分组下拖拽均生效）。

**Architecture:** 新增 `labels` / `task_labels` 两表与 `src/lib/label.ts` 服务层，权限沿既有军规（标签定义仅 admin 可改，贴附走 `TASK_WRITE_ROLES`）。筛选与分组为**纯函数**（`src/lib/board-filters.ts` / `src/lib/board-columns.ts`），任务全量由 Server Component 注入，筛选态写入 URL query。`moveTaskAction` 由「只改 status」泛化为四字段白名单，校验仍全数落在既有 `updateTask`。

**Tech Stack:** Next.js 16 App Router · React 19 · Drizzle ORM + PostgreSQL 16 · zod v4 · @dnd-kit/core · Vitest

**设计文档：** `docs/superpowers/specs/2026-08-20-agilecampus-labels-filters-design.md`

---

## 文件结构

**新建：**

| 文件 | 职责 |
|---|---|
| `src/lib/label.ts` | 标签服务层：增删改查 + 贴附任务 |
| `src/lib/board-filters.ts` | 纯函数：URL query ↔ 筛选态，筛选任务数组 |
| `src/lib/board-columns.ts` | 纯函数：由分组维度推导看板列定义；标签色板常量 |
| `src/app/(app)/teams/[teamId]/labels/page.tsx` | 标签管理页（Server Component） |
| `src/app/(app)/teams/[teamId]/labels/actions.ts` | 标签增删改 Server Actions |
| `src/app/(app)/teams/[teamId]/labels/label-forms.tsx` | 新建/编辑标签表单（Client） |
| `src/app/(app)/projects/[projectId]/filter-bar.tsx` | 筛选栏 + 分组选择（Client） |
| `tests/label.test.ts` | 标签服务层测试 |
| `tests/board-filters.test.ts` | 筛选与列推导纯函数测试 |

**修改：**

| 文件 | 改动 |
|---|---|
| `src/db/schema.ts` | 追加 `labelColorEnum` / `labels` / `taskLabels` |
| `tests/helpers.ts` | `resetDb` 的 TRUNCATE 列表加两张新表 |
| `src/lib/task.ts` | 导出 `requireTaskWrite`；`listProjectTasks` / `getTaskDetail` 带 labels |
| `src/app/(app)/projects/[projectId]/actions.ts` | `moveTaskAction` 泛化；`updateTaskAction` 收 `labelIds` |
| `src/app/(app)/projects/[projectId]/board.tsx` | 列由 `deriveColumns` 推导；拖拽按 patch 提交 |
| `src/app/(app)/projects/[projectId]/task-card.tsx` | 卡面显示标签；弹窗内多选标签 |
| `src/app/(app)/projects/[projectId]/page.tsx` | 取标签、渲染筛选栏、透传 |
| `src/app/(app)/teams/page.tsx` | 团队卡片加「标签」入口 |
| `README.md` | 路由表加一行 |

**与设计文档的两处偏离（施工后须同步修订 spec）：**

1. 唯一索引建在 `(teamId, name)` 普通两列，大小写不敏感去重由服务层 `lower()` 查询承担——避开 drizzle-kit push 对表达式索引 diff 的不稳。
2. 不另设 `setTaskLabelsAction`，标签随 `updateTaskAction` 的 `labelIds` 一并提交——同构于既有 `successorIds` 之形制，少一个 action。

---

## Task 1: 标签表 + `createLabel` / `listTeamLabels`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `tests/helpers.ts:6`
- Create: `src/lib/label.ts`
- Test: `tests/label.test.ts`

- [ ] **Step 1: 先扩 resetDb 的清表列表**

改 `tests/helpers.ts`，在 TRUNCATE 列表最前加两张新表：

```ts
export async function resetDb() {
  await db.execute(
    sql`TRUNCATE task_labels, labels, resource_usages, api_tokens, task_dependencies, messages, conversations, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 2: 写失败测试**

创建 `tests/label.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createLabel, listTeamLabels } from "@/lib/label";
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
  return { owner, team, student, teacher, outsider };
}

describe("createLabel", () => {
  beforeEach(resetDb);

  it("admin 可建标签，默认色 slate", async () => {
    const { owner, team } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    expect(label.name).toBe("论文");
    expect(label.color).toBe("slate");
  });

  it("student 建标签被拒", async () => {
    const { student, team } = await scene();
    await expect(createLabel(student.id, team.id, { name: "实验" })).rejects.toThrow("没有权限");
  });

  it("非成员建标签被拒", async () => {
    const { outsider, team } = await scene();
    await expect(createLabel(outsider.id, team.id, { name: "实验" })).rejects.toThrow("没有权限");
  });

  it("同团队重名（大小写不同）被拒", async () => {
    const { owner, team } = await scene();
    await createLabel(owner.id, team.id, { name: "Paper" });
    await expect(createLabel(owner.id, team.id, { name: "paper" })).rejects.toThrow("标签已存在");
  });

  it("空名与超长名被拒", async () => {
    const { owner, team } = await scene();
    await expect(createLabel(owner.id, team.id, { name: "   " })).rejects.toThrow("不可为空");
    await expect(createLabel(owner.id, team.id, { name: "字".repeat(21) })).rejects.toThrow("超过");
  });

  it("名称写入前 trim", async () => {
    const { owner, team } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "  数据清洗  " });
    expect(label.name).toBe("数据清洗");
  });
});

describe("listTeamLabels", () => {
  beforeEach(resetDb);

  it("团队成员（含 teacher）可读，按名称排序", async () => {
    const { owner, team, teacher } = await scene();
    await createLabel(owner.id, team.id, { name: "实验", color: "green" });
    await createLabel(owner.id, team.id, { name: "代码", color: "blue" });
    const list = await listTeamLabels(teacher.id, team.id);
    expect(list.map((l) => l.name)).toEqual(["代码", "实验"]);
  });

  it("非成员读取被拒", async () => {
    const { outsider, team } = await scene();
    await expect(listTeamLabels(outsider.id, team.id)).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npm test -- tests/label.test.ts
```

Expected: FAIL，报 `Failed to resolve import "@/lib/label"`。

- [ ] **Step 4: 追加 schema**

改 `src/db/schema.ts`：首行 import 列表加 `primaryKey`，并在文件**末尾**追加：

```ts
export const labelColorEnum = pgEnum("label_color", [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

// 标签挂在团队而非项目：实验室内项目多且同质，共享一套免去每建一项目重建之苦。
// 唯一索引建在普通两列，大小写不敏感去重由 lib/label.ts 的 lower() 查询承担。
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);
```

- [ ] **Step 5: 推 schema 到测试库与开发库**

```bash
npm run db:push:test && npm run db:push
```

Expected: 两条命令皆输出 `Changes applied`。

- [ ] **Step 6: 写 `src/lib/label.ts` 最小实现**

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { labels, type LabelColor } from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getTeamMembership, requireTeamRole } from "./team";

const LABEL_NAME_MAX = 20;

function normalizeName(raw: string) {
  const name = raw.trim();
  if (!name) throw new AppError("标签名不可为空");
  if (name.length > LABEL_NAME_MAX)
    throw new AppError(`标签名不可超过 ${LABEL_NAME_MAX} 字`);
  return name;
}

// 大小写不敏感查重。excludeId 供改名时排除自身。
async function assertNameFree(teamId: string, name: string, excludeId?: string) {
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.teamId, teamId), sql`lower(${labels.name}) = lower(${name})`));
  if (rows.some((r) => r.id !== excludeId)) throw new AppError("标签已存在");
}

export async function listTeamLabels(actorId: string, teamId: string) {
  const member = await getTeamMembership(actorId, teamId);
  if (!member) throw new ForbiddenError();
  return db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(eq(labels.teamId, teamId))
    .orderBy(labels.name);
}

export async function createLabel(
  actorId: string,
  teamId: string,
  input: { name: string; color?: LabelColor },
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const name = normalizeName(input.name);
  await assertNameFree(teamId, name);

  try {
    const [label] = await db
      .insert(labels)
      .values({ teamId, name, color: input.color ?? "slate" })
      .returning();
    return label;
  } catch (e) {
    // 查重与插入之间的并发窗口，由唯一约束兜底（同 joinTeam 之形制）
    if (isUniqueViolation(e)) throw new AppError("标签已存在");
    throw e;
  }
}
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npm test -- tests/label.test.ts
```

Expected: PASS，8 个用例全绿。

- [ ] **Step 8: 提交**

```bash
git add src/db/schema.ts src/lib/label.ts tests/label.test.ts tests/helpers.ts
git commit -m "feat: 团队级标签表与创建/列举服务"
```

---

## Task 2: `renameLabel` / `deleteLabel`

**Files:**
- Modify: `src/lib/label.ts`
- Test: `tests/label.test.ts`

- [ ] **Step 1: 追加失败测试**

`tests/label.test.ts` 的 import 行改为
`import { createLabel, listTeamLabels, renameLabel, deleteLabel } from "@/lib/label";`
并在文件末尾追加：

```ts
describe("renameLabel", () => {
  beforeEach(resetDb);

  it("admin 可改名换色", async () => {
    const { owner, team } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    const updated = await renameLabel(owner.id, label.id, { name: "论文写作", color: "violet" });
    expect(updated.name).toBe("论文写作");
    expect(updated.color).toBe("violet");
  });

  it("改名撞上同团队既有标签被拒", async () => {
    const { owner, team } = await scene();
    await createLabel(owner.id, team.id, { name: "论文" });
    const other = await createLabel(owner.id, team.id, { name: "实验" });
    await expect(renameLabel(owner.id, other.id, { name: "论文" })).rejects.toThrow("标签已存在");
  });

  it("改成自身原名不算重名", async () => {
    const { owner, team } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    const updated = await renameLabel(owner.id, label.id, { name: "论文", color: "red" });
    expect(updated.color).toBe("red");
  });

  it("student 改标签被拒", async () => {
    const { owner, team, student } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    await expect(renameLabel(student.id, label.id, { name: "改名" })).rejects.toThrow("没有权限");
  });
});

describe("deleteLabel", () => {
  beforeEach(resetDb);

  it("admin 可删标签", async () => {
    const { owner, team } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    await deleteLabel(owner.id, label.id);
    expect(await listTeamLabels(owner.id, team.id)).toEqual([]);
  });

  it("student 删标签被拒", async () => {
    const { owner, team, student } = await scene();
    const label = await createLabel(owner.id, team.id, { name: "论文" });
    await expect(deleteLabel(student.id, label.id)).rejects.toThrow("没有权限");
  });

  it("标签不存在则报错", async () => {
    const { owner } = await scene();
    await expect(
      deleteLabel(owner.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("标签不存在");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/label.test.ts
```

Expected: FAIL，报 `renameLabel is not a function` 或导入失败。

- [ ] **Step 3: 实现**

在 `src/lib/label.ts` 末尾追加：

```ts
// 标签管理权限：先由 labelId 取得 teamId，再校验 admin
async function requireLabelAdmin(actorId: string, labelId: string) {
  const [label] = await db.select().from(labels).where(eq(labels.id, labelId));
  if (!label) throw new AppError("标签不存在");
  await requireTeamRole(actorId, label.teamId, ["admin"]);
  return label;
}

export async function renameLabel(
  actorId: string,
  labelId: string,
  patch: { name?: string; color?: LabelColor },
) {
  const label = await requireLabelAdmin(actorId, labelId);
  const name = patch.name === undefined ? undefined : normalizeName(patch.name);
  if (name !== undefined) await assertNameFree(label.teamId, name, labelId);

  const [updated] = await db
    .update(labels)
    .set({
      ...(name !== undefined && { name }),
      ...(patch.color !== undefined && { color: patch.color }),
    })
    .where(eq(labels.id, labelId))
    .returning();
  return updated;
}

export async function deleteLabel(actorId: string, labelId: string) {
  await requireLabelAdmin(actorId, labelId);
  // task_labels 的 cascade 会自动撕下所有贴附
  await db.delete(labels).where(eq(labels.id, labelId));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- tests/label.test.ts
```

Expected: PASS，15 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/label.ts tests/label.test.ts
git commit -m "feat: 标签改名换色与删除"
```

---

## Task 3: `setTaskLabels` 贴附任务

**Files:**
- Modify: `src/lib/task.ts:29`（`requireTaskWrite` 加 `export`）
- Modify: `src/lib/label.ts`
- Test: `tests/label.test.ts`

- [ ] **Step 1: 追加失败测试**

`tests/label.test.ts` 顶部 import 追加三行：

```ts
import { createProject } from "@/lib/project";
import { createTask, listProjectTasks } from "@/lib/task";
import { setTaskLabels } from "@/lib/label";
```

末尾追加：

```ts
describe("setTaskLabels", () => {
  beforeEach(resetDb);

  it("student 可贴标签，全量替换", async () => {
    const { owner, team, student } = await scene();
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    const task = await createTask(student.id, project.id, { title: "撰写问卷" });
    const paper = await createLabel(owner.id, team.id, { name: "论文" });
    const code = await createLabel(owner.id, team.id, { name: "代码" });

    await setTaskLabels(student.id, task.id, [paper.id, code.id]);
    await setTaskLabels(student.id, task.id, [code.id]);

    const [row] = await listProjectTasks(student.id, project.id);
    expect(row.labels.map((l) => l.name)).toEqual(["代码"]);
  });

  it("重复 labelId 去重后不报错", async () => {
    const { owner, team, student } = await scene();
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    const task = await createTask(student.id, project.id, { title: "撰写问卷" });
    const paper = await createLabel(owner.id, team.id, { name: "论文" });

    await setTaskLabels(student.id, task.id, [paper.id, paper.id]);
    const [row] = await listProjectTasks(student.id, project.id);
    expect(row.labels).toHaveLength(1);
  });

  it("teacher 贴标签被拒（只读角色）", async () => {
    const { owner, team, teacher, student } = await scene();
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    const task = await createTask(student.id, project.id, { title: "撰写问卷" });
    const paper = await createLabel(owner.id, team.id, { name: "论文" });
    await expect(setTaskLabels(teacher.id, task.id, [paper.id])).rejects.toThrow("没有权限");
  });

  it("跨团队标签挂载被拒", async () => {
    const { owner, team, student } = await scene();
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    const task = await createTask(student.id, project.id, { title: "撰写问卷" });

    const other = await makeUser("other-admin@example.com");
    const otherTeam = await createTeam(other.id, "西蜀实验室");
    const alien = await createLabel(other.id, otherTeam.id, { name: "外营标签" });

    await expect(setTaskLabels(student.id, task.id, [alien.id])).rejects.toThrow(
      "标签不属于该团队",
    );
  });

  it("任务不存在则报错", async () => {
    const { student } = await scene();
    await expect(
      setTaskLabels(student.id, "00000000-0000-0000-0000-000000000000", []),
    ).rejects.toThrow("任务不存在");
  });

  it("删标签后任务上的贴附随之消失", async () => {
    const { owner, team, student } = await scene();
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    const task = await createTask(student.id, project.id, { title: "撰写问卷" });
    const paper = await createLabel(owner.id, team.id, { name: "论文" });
    await setTaskLabels(student.id, task.id, [paper.id]);

    await deleteLabel(owner.id, paper.id);
    const [row] = await listProjectTasks(student.id, project.id);
    expect(row.labels).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/label.test.ts
```

Expected: FAIL，`setTaskLabels is not a function`。

- [ ] **Step 3: 从 `src/lib/task.ts` 导出 `requireTaskWrite`**

`src/lib/task.ts:29` 的函数签名前加 `export`，并补一行注释：

```ts
// 供 lib/label.ts 复用：贴标签属任务写操作，权限口径须与 createTask/updateTask 一致
export async function requireTaskWrite(actorId: string, projectId: string) {
```

依赖方向须为 `label.ts → task.ts` 单向；`task.ts` 不得反向 import `label.ts`（Task 4 的标签查询直接写在 `task.ts` 内，正为避此环）。

- [ ] **Step 4: 实现 `setTaskLabels`**

`src/lib/label.ts` 顶部 import 段整体替换为：

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { labels, taskLabels, tasks, type LabelColor } from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getTeamMembership, requireTeamRole } from "./team";
import { requireTaskWrite } from "./task";
```

文件末尾追加：

```ts
// 全量替换某任务的标签，同构于 lib/task.ts 的 setTaskSuccessors
export async function setTaskLabels(actorId: string, taskId: string, labelIds: string[]) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);
  const unique = [...new Set(labelIds)];

  if (unique.length > 0) {
    const owned = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.teamId, access.project.teamId), inArray(labels.id, unique)));
    // 数目对不上即有标签不属本团队——杜绝跨团队挂载
    if (owned.length !== unique.length) throw new AppError("标签不属于该团队");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
    if (unique.length > 0) {
      await tx.insert(taskLabels).values(unique.map((labelId) => ({ taskId, labelId })));
    }
  });
}
```

- [ ] **Step 5: 跑测试**

```bash
npm test -- tests/label.test.ts
```

Expected: 权限类三例（teacher 被拒、跨团队被拒、任务不存在）PASS；三例读取类（全量替换、去重、删标签后消失）FAIL，因 `row.labels` 尚为 undefined。此为预期，Task 4 补齐。

- [ ] **Step 6: 提交（此步允许上述三例暂红）**

```bash
git add src/lib/task.ts src/lib/label.ts tests/label.test.ts
git commit -m "feat: setTaskLabels 贴附标签至任务"
```

---

## Task 4: 读取层带出标签

**Files:**
- Modify: `src/lib/task.ts`（`listProjectTasks`、`getTaskDetail`）
- Test: `tests/label.test.ts`（Task 3 遗留的三例此步转绿）

- [ ] **Step 1: 在 `src/lib/task.ts` 加标签归并辅助函数**

顶部两处 import 调整为：

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  labels,
  milestones,
  taskDependencies,
  taskLabels,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
```

在 `listProjectTasks` 之前插入：

```ts
export type TaskLabel = { id: string; name: string; color: string };

// 另发一次查询按 taskId 归并，不用 leftJoin：join 会造成行乘积，
// 污染既有 orderBy(sortOrder) 与调用方「一行一任务」的假设。
async function labelsByTask(taskIds: string[]): Promise<Map<string, TaskLabel[]>> {
  const map = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(labels.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}
```

- [ ] **Step 2: 改 `listProjectTasks` 返回值**

整个函数替换为：

```ts
export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      completionNote: tasks.completionNote,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);

  const byTask = await labelsByTask(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, labels: byTask.get(r.id) ?? [] }));
}
```

- [ ] **Step 3: 改 `getTaskDetail` 同样带标签**

把 `getTaskDetail` 末尾两行

```ts
  await requireProjectAccess(actorId, row.projectId);
  return row;
```

改为：

```ts
  await requireProjectAccess(actorId, row.projectId);
  const byTask = await labelsByTask([row.id]);
  return { ...row, labels: byTask.get(row.id) ?? [] };
```

- [ ] **Step 4: 跑标签与任务相关测试**

```bash
npm test -- tests/label.test.ts tests/task.test.ts tests/task-detail.test.ts
```

Expected: PASS，全绿（Task 3 遗留三例此时转绿）。

- [ ] **Step 5: 跑全量测试确认未伤及既有阵线**

```bash
npm test
```

Expected: PASS。若 `agent-*.test.ts` 因任务快照多出 `labels` 字段而失败，说明该断言过严——把 `toEqual` 改为 `toMatchObject` 只校验所关心的字段，勿改 `labels` 设计。

- [ ] **Step 6: 提交**

```bash
git add src/lib/task.ts
git commit -m "feat: 任务读取带出标签"
```

---

## Task 5: 筛选纯函数 `board-filters.ts`

**Files:**
- Create: `src/lib/board-filters.ts`
- Test: `tests/board-filters.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/board-filters.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  parseFilters,
  serializeFilters,
  applyFilters,
  type FilterableTask,
} from "@/lib/board-filters";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const M = "33333333-3333-3333-3333-333333333333";
const L = "44444444-4444-4444-4444-444444444444";

function task(over: Partial<FilterableTask> = {}): FilterableTask {
  return {
    assigneeId: null,
    priority: "medium",
    milestoneId: null,
    dueDate: null,
    status: "todo",
    labels: [],
    ...over,
  };
}

describe("parseFilters", () => {
  it("空参数返回空筛选，默认按状态分组", () => {
    expect(parseFilters(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  it("解析多值与开关", () => {
    const f = parseFilters(
      new URLSearchParams(`assignee=${A},${B}&priority=high&overdue=1&group=assignee`),
    );
    expect(f.assignee).toEqual([A, B]);
    expect(f.priority).toEqual(["high"]);
    expect(f.overdue).toBe(true);
    expect(f.group).toBe("assignee");
  });

  it("非法值被忽略而非抛错", () => {
    const f = parseFilters(new URLSearchParams("assignee=不是uuid&priority=urgent&group=galaxy"));
    expect(f.assignee).toEqual([]);
    expect(f.priority).toEqual([]);
    expect(f.group).toBe("status");
  });

  it("assignee 与 milestone 接受 none 表示未指派/无里程碑", () => {
    const f = parseFilters(new URLSearchParams("assignee=none&milestone=none"));
    expect(f.assignee).toEqual(["none"]);
    expect(f.milestone).toEqual(["none"]);
  });

  it("无关参数（如深链 task）不影响解析", () => {
    const f = parseFilters(new URLSearchParams(`task=${A}`));
    expect(f).toEqual(EMPTY_FILTERS);
  });
});

describe("serializeFilters", () => {
  it("空筛选序列化为空串", () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  });

  it("与 parseFilters 往返一致", () => {
    const f = {
      ...EMPTY_FILTERS,
      assignee: [A, B],
      label: [L],
      overdue: true,
      group: "milestone" as const,
    };
    expect(parseFilters(new URLSearchParams(serializeFilters(f)))).toEqual(f);
  });

  it("默认分组不写入 query", () => {
    expect(serializeFilters({ ...EMPTY_FILTERS, group: "status" })).toBe("");
  });
});

describe("applyFilters", () => {
  const today = "2026-08-20";

  it("无筛选则原样返回", () => {
    const list = [task(), task({ priority: "high" })];
    expect(applyFilters(list, EMPTY_FILTERS, today)).toHaveLength(2);
  });

  it("按指派人筛选，none 命中未指派", () => {
    const list = [task({ assigneeId: A }), task({ assigneeId: null })];
    expect(applyFilters(list, { ...EMPTY_FILTERS, assignee: [A] }, today)).toHaveLength(1);
    expect(applyFilters(list, { ...EMPTY_FILTERS, assignee: ["none"] }, today)).toHaveLength(1);
  });

  it("按标签筛选：任务命中任一所选标签即算", () => {
    const list = [task({ labels: [{ id: L }] }), task()];
    expect(applyFilters(list, { ...EMPTY_FILTERS, label: [L] }, today)).toHaveLength(1);
  });

  it("按里程碑筛选，none 命中无里程碑", () => {
    const list = [task({ milestoneId: M }), task()];
    expect(applyFilters(list, { ...EMPTY_FILTERS, milestone: ["none"] }, today)).toHaveLength(1);
  });

  it("逾期开关：截止日早于今日且未完成方算逾期", () => {
    const list = [
      task({ dueDate: "2026-08-19" }),
      task({ dueDate: "2026-08-19", status: "done" }),
      task({ dueDate: "2026-08-21" }),
      task({ dueDate: null }),
    ];
    expect(applyFilters(list, { ...EMPTY_FILTERS, overdue: true }, today)).toHaveLength(1);
  });

  it("多维筛选取交集", () => {
    const list = [
      task({ assigneeId: A, priority: "high" }),
      task({ assigneeId: A, priority: "low" }),
      task({ assigneeId: B, priority: "high" }),
    ];
    const f = { ...EMPTY_FILTERS, assignee: [A], priority: ["high"] };
    expect(applyFilters(list, f, today)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/board-filters.test.ts
```

Expected: FAIL，`Failed to resolve import "@/lib/board-filters"`。

- [ ] **Step 3: 实现**

创建 `src/lib/board-filters.ts`：

```ts
// 看板筛选态 ↔ URL query 的纯函数模块。无 IO、不取系统时钟，
// 「今日」由调用方传入，便于单测。
export type GroupBy = "status" | "assignee" | "priority" | "milestone";

export type BoardFilters = {
  assignee: string[]; // uuid 或 "none"（未指派）
  priority: string[];
  label: string[]; // uuid
  milestone: string[]; // uuid 或 "none"（无里程碑）
  overdue: boolean;
  group: GroupBy;
};

export type FilterableTask = {
  assigneeId: string | null;
  priority: string;
  milestoneId: string | null;
  dueDate: string | null;
  status: string;
  labels: { id: string }[];
};

const GROUPS: GroupBy[] = ["status", "assignee", "priority", "milestone"];
const PRIORITIES = ["low", "medium", "high"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EMPTY_FILTERS: BoardFilters = {
  assignee: [],
  priority: [],
  label: [],
  milestone: [],
  overdue: false,
  group: "status",
};

function idList(raw: string | null, allowNone: boolean): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s) || (allowNone && s === "none"));
}

export function parseFilters(params: URLSearchParams): BoardFilters {
  const group = params.get("group");
  return {
    assignee: idList(params.get("assignee"), true),
    priority: (params.get("priority") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PRIORITIES.includes(s)),
    label: idList(params.get("label"), false),
    milestone: idList(params.get("milestone"), true),
    overdue: params.get("overdue") === "1",
    group: GROUPS.includes(group as GroupBy) ? (group as GroupBy) : "status",
  };
}

// 返回不含 "?" 的 query string；空筛选返回空串（URL 保持干净）
export function serializeFilters(f: BoardFilters): string {
  const p = new URLSearchParams();
  if (f.assignee.length) p.set("assignee", f.assignee.join(","));
  if (f.priority.length) p.set("priority", f.priority.join(","));
  if (f.label.length) p.set("label", f.label.join(","));
  if (f.milestone.length) p.set("milestone", f.milestone.join(","));
  if (f.overdue) p.set("overdue", "1");
  if (f.group !== "status") p.set("group", f.group);
  return p.toString();
}

export function applyFilters<T extends FilterableTask>(
  list: T[],
  f: BoardFilters,
  today: string,
): T[] {
  return list.filter((t) => {
    if (f.assignee.length && !f.assignee.includes(t.assigneeId ?? "none")) return false;
    if (f.priority.length && !f.priority.includes(t.priority)) return false;
    if (f.milestone.length && !f.milestone.includes(t.milestoneId ?? "none")) return false;
    if (f.label.length && !t.labels.some((l) => f.label.includes(l.id))) return false;
    if (f.overdue && !(t.dueDate && t.dueDate < today && t.status !== "done")) return false;
    return true;
  });
}
```

注意 `serializeFilters` 用 `URLSearchParams.toString()`，逗号会被编码为 `%2C`；`parseFilters` 经 `URLSearchParams` 解析时自动还原，往返一致。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- tests/board-filters.test.ts
```

Expected: PASS，14 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/board-filters.ts tests/board-filters.test.ts
git commit -m "feat: 看板筛选纯函数与 URL 序列化"
```

---

## Task 6: 列推导纯函数 `board-columns.ts`

**Files:**
- Create: `src/lib/board-columns.ts`
- Test: `tests/board-filters.test.ts`（追加 describe 块）

- [ ] **Step 1: 追加失败测试**

`tests/board-filters.test.ts` 顶部 import 追加：

```ts
import { deriveColumns } from "@/lib/board-columns";
```

末尾追加：

```ts
describe("deriveColumns", () => {
  const ctx = {
    members: [
      { id: A, name: "周瑜" },
      { id: B, name: "鲁肃" },
    ],
    milestones: [{ id: M, name: "一期" }],
  };

  it("按状态分组：三列，patch 改 status", () => {
    const cols = deriveColumns("status", ctx);
    expect(cols.map((c) => c.key)).toEqual(["todo", "doing", "done"]);
    expect(cols[1].patch).toEqual({ status: "doing" });
    expect(cols[1].matches(task({ status: "doing" }))).toBe(true);
    expect(cols[1].matches(task({ status: "todo" }))).toBe(false);
  });

  it("按指派人分组：每成员一列 + 未指派列，patch 改 assigneeId", () => {
    const cols = deriveColumns("assignee", ctx);
    expect(cols.map((c) => c.key)).toEqual([A, B, "none"]);
    expect(cols[0].patch).toEqual({ assigneeId: A });
    expect(cols[2].patch).toEqual({ assigneeId: null });
    expect(cols[2].matches(task({ assigneeId: null }))).toBe(true);
  });

  it("按优先级分组：高中低三列，patch 改 priority", () => {
    const cols = deriveColumns("priority", ctx);
    expect(cols.map((c) => c.key)).toEqual(["high", "medium", "low"]);
    expect(cols[0].patch).toEqual({ priority: "high" });
  });

  it("按里程碑分组：每里程碑一列 + 无里程碑列", () => {
    const cols = deriveColumns("milestone", ctx);
    expect(cols.map((c) => c.key)).toEqual([M, "none"]);
    expect(cols[1].patch).toEqual({ milestoneId: null });
    expect(cols[0].matches(task({ milestoneId: M }))).toBe(true);
  });

  it("成员为空时按指派人分组仍有未指派列", () => {
    const cols = deriveColumns("assignee", { members: [], milestones: [] });
    expect(cols.map((c) => c.key)).toEqual(["none"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/board-filters.test.ts
```

Expected: FAIL，`Failed to resolve import "@/lib/board-columns"`。

- [ ] **Step 3: 实现**

创建 `src/lib/board-columns.ts`：

```ts
import type { FilterableTask, GroupBy } from "./board-filters";

// 拖拽落列时提交的字段补丁。四字段与 moveTaskAction 的白名单严格对应。
export type ColumnPatch = {
  status?: "todo" | "doing" | "done";
  assigneeId?: string | null;
  priority?: "low" | "medium" | "high";
  milestoneId?: string | null;
};

export type BoardColumn = {
  key: string;
  label: string;
  tone: string; // tailwind 文字色 class
  patch: ColumnPatch;
  matches: (t: FilterableTask) => boolean;
};

export type ColumnContext = {
  members: { id: string; name: string }[];
  milestones: { id: string; name: string }[];
};

const NEUTRAL = "text-ink-soft";

export function deriveColumns(group: GroupBy, ctx: ColumnContext): BoardColumn[] {
  switch (group) {
    case "assignee":
      return [
        ...ctx.members.map((m) => ({
          key: m.id,
          label: m.name,
          tone: NEUTRAL,
          patch: { assigneeId: m.id } as ColumnPatch,
          matches: (t: FilterableTask) => t.assigneeId === m.id,
        })),
        {
          key: "none",
          label: "未指派",
          tone: "text-ink-faint",
          patch: { assigneeId: null },
          matches: (t: FilterableTask) => t.assigneeId === null,
        },
      ];

    case "priority":
      return (
        [
          { key: "high", label: "高", tone: "text-high" },
          { key: "medium", label: "中", tone: "text-medium" },
          { key: "low", label: "低", tone: "text-low" },
        ] as const
      ).map((c) => ({
        key: c.key,
        label: c.label,
        tone: c.tone,
        patch: { priority: c.key } as ColumnPatch,
        matches: (t: FilterableTask) => t.priority === c.key,
      }));

    case "milestone":
      return [
        ...ctx.milestones.map((m) => ({
          key: m.id,
          label: m.name,
          tone: NEUTRAL,
          patch: { milestoneId: m.id } as ColumnPatch,
          matches: (t: FilterableTask) => t.milestoneId === m.id,
        })),
        {
          key: "none",
          label: "无里程碑",
          tone: "text-ink-faint",
          patch: { milestoneId: null },
          matches: (t: FilterableTask) => t.milestoneId === null,
        },
      ];

    case "status":
    default:
      return (
        [
          { key: "todo", label: "待办", tone: "text-todo" },
          { key: "doing", label: "进行中", tone: "text-doing" },
          { key: "done", label: "已完成", tone: "text-done" },
        ] as const
      ).map((c) => ({
        key: c.key,
        label: c.label,
        tone: c.tone,
        patch: { status: c.key } as ColumnPatch,
        matches: (t: FilterableTask) => t.status === c.key,
      }));
  }
}

// 标签色板：色板键 → tailwind class。存键不存 hex，配色可控且杜绝样式注入。
export const LABEL_COLORS = [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
] as const;

export const LABEL_COLOR_CLASS: Record<string, string> = {
  slate: "bg-sunken text-ink-soft",
  red: "bg-high-soft text-high",
  amber: "bg-medium-soft text-medium",
  green: "bg-low-soft text-low",
  blue: "bg-primary-soft text-primary",
  violet: "bg-primary-soft text-primary",
  pink: "bg-high-soft text-high",
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- tests/board-filters.test.ts
```

Expected: PASS，19 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/board-columns.ts tests/board-filters.test.ts
git commit -m "feat: 看板列推导纯函数与标签色板"
```

---

## Task 7: `moveTaskAction` 泛化为字段白名单

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/actions.ts:88-116`（`moveTaskSchema` 与 `moveTaskAction`）
- Modify: `src/app/(app)/projects/[projectId]/actions.ts`（`updateTaskAction` 收 `labelIds`）

- [ ] **Step 1: 替换 `moveTaskSchema` 与 `moveTaskAction`**

把 `actions.ts` 中现有的 `const moveTaskSchema = ...` 至 `moveTaskAction` 函数结尾的整段替换为：

```ts
// 拖拽可改的字段白名单。校验与授权仍全数落在 updateTask
//（指派人须属团队、里程碑须属项目），故此处只做形状校验。
const movePatchSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  milestoneId: z.uuid().nullable().optional(),
});

const moveTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  patch: movePatchSchema,
});

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  patch: z.infer<typeof movePatchSchema>;
}): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "参数无效" };
  // 空补丁无事可做，视为非法请求
  if (Object.keys(parsed.data.patch).length === 0) return { error: "参数无效" };

  try {
    await updateTask(session.user.id, parsed.data.taskId, parsed.data.patch);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
```

- [ ] **Step 2: 让 `updateTaskAction` 一并保存标签**

`actions.ts` 顶部 import 追加：

```ts
import { setTaskLabels } from "@/lib/label";
```

在 `updateTaskAction` 内，紧随既有 `const successorIds = ...` 之后插入：

```ts
  const labelIds = formData
    .getAll("labelIds")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
```

并在 `try` 块内 `await setTaskSuccessors(session.user.id, taskId, successorIds);` 之后插入：

```ts
    await setTaskLabels(session.user.id, taskId, labelIds);
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 只报 `board.tsx` 中 `moveTaskAction({ taskId, projectId, status })` 参数不匹配——此为预期，Task 9 修正。其余文件无错。

- [ ] **Step 4: 提交**

```bash
git add "src/app/(app)/projects/[projectId]/actions.ts"
git commit -m "feat: moveTaskAction 泛化为四字段白名单，任务保存带标签"
```

---

## Task 8: 标签管理页 `/teams/[teamId]/labels`

**Files:**
- Create: `src/app/(app)/teams/[teamId]/labels/actions.ts`
- Create: `src/app/(app)/teams/[teamId]/labels/label-forms.tsx`
- Create: `src/app/(app)/teams/[teamId]/labels/page.tsx`
- Modify: `src/app/(app)/teams/page.tsx:48-57`

- [ ] **Step 1: 写 Server Actions**

创建 `src/app/(app)/teams/[teamId]/labels/actions.ts`：

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createLabel, renameLabel, deleteLabel } from "@/lib/label";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;

const COLOR = z.enum(["slate", "red", "amber", "green", "blue", "violet", "pink"]);

const createSchema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1, "请填写标签名"),
  color: COLOR,
});

export async function createLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createLabel(session.user.id, parsed.data.teamId, {
      name: parsed.data.name,
      color: parsed.data.color,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}

const renameSchema = z.object({
  teamId: z.uuid(),
  labelId: z.uuid(),
  name: z.string().trim().min(1, "请填写标签名"),
  color: COLOR,
});

export async function renameLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await renameLabel(session.user.id, parsed.data.labelId, {
      name: parsed.data.name,
      color: parsed.data.color,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}

const deleteSchema = z.object({ teamId: z.uuid(), labelId: z.uuid() });

export async function deleteLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteLabel(session.user.id, parsed.data.labelId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}
```

- [ ] **Step 2: 写表单组件**

创建 `src/app/(app)/teams/[teamId]/labels/label-forms.tsx`：

```tsx
"use client";

import { useActionState, useState } from "react";
import { LABEL_COLORS, LABEL_COLOR_CLASS } from "@/lib/board-columns";
import {
  createLabelAction,
  renameLabelAction,
  deleteLabelAction,
  type FormState,
} from "./actions";

export function NewLabelForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createLabelAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card flex flex-wrap items-end gap-2 p-4">
      <input type="hidden" name="teamId" value={teamId} />
      <label className="space-y-1">
        <span className="text-xs font-medium text-ink-soft">标签名</span>
        <input name="name" maxLength={20} className="ac-field text-sm" placeholder="如：论文" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-ink-soft">颜色</span>
        <select name="color" defaultValue="slate" className="ac-field w-auto text-sm">
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "新建标签"}
      </button>
      {state?.error && <p className="w-full text-sm text-high">{state.error}</p>}
    </form>
  );
}

export function LabelRow({
  teamId,
  label,
  usage,
  isAdmin,
}: {
  teamId: string;
  label: { id: string; name: string; color: string };
  usage: number;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [renameState, renameFormAction, renaming] = useActionState<FormState, FormData>(
    renameLabelAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState<FormState, FormData>(
    deleteLabelAction,
    null,
  );

  return (
    <li className="ac-card flex flex-wrap items-center justify-between gap-2 p-4">
      <span className="flex items-center gap-2">
        <span className={`ac-badge ${LABEL_COLOR_CLASS[label.color] ?? LABEL_COLOR_CLASS.slate}`}>
          {label.name}
        </span>
        <span className="text-xs text-ink-faint">{usage} 个任务</span>
      </span>

      {isAdmin && !editing && (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-ink-faint hover:text-primary hover:underline"
          >
            编辑
          </button>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!confirm(`确认删除标签「${label.name}」？所有任务上的该标签将一并撕下。`))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="labelId" value={label.id} />
            <button disabled={deleting} className="text-xs text-high underline disabled:opacity-50">
              删除
            </button>
          </form>
        </span>
      )}

      {isAdmin && editing && (
        <form action={renameFormAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="labelId" value={label.id} />
          <input
            name="name"
            defaultValue={label.name}
            maxLength={20}
            className="ac-field w-32 py-1 text-sm"
          />
          <select name="color" defaultValue={label.color} className="ac-field w-auto py-1 text-sm">
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button disabled={renaming} className="ac-btn px-2 py-1 text-xs">
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ac-btn-ghost px-2 py-1 text-xs"
          >
            取消
          </button>
        </form>
      )}

      {(renameState?.error || deleteState?.error) && (
        <p className="w-full text-xs text-high">{renameState?.error ?? deleteState?.error}</p>
      )}
    </li>
  );
}
```

- [ ] **Step 3: 写页面**

创建 `src/app/(app)/teams/[teamId]/labels/page.tsx`：

```tsx
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { labels, taskLabels, teams } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { listTeamLabels } from "@/lib/label";
import { NewLabelForm, LabelRow } from "./label-forms";

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  // teamId 来自 URL，非法 uuid 提前拦截，语义等同「不存在」
  if (!z.uuid().safeParse(teamId).success) notFound();

  // 访问者必须是团队成员（非成员 404，不泄露团队存在性）
  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  const list = await listTeamLabels(session.user.id, teamId);

  const usageRows = await db
    .select({ labelId: taskLabels.labelId, count: sql<number>`count(*)::int` })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(eq(labels.teamId, teamId))
    .groupBy(taskLabels.labelId);
  const usage = new Map(usageRows.map((r) => [r.labelId, r.count]));

  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-2xl space-y-6 py-8">
      <h1 className="font-display text-2xl font-semibold text-ink">{team.name} · 标签</h1>
      <p className="text-sm text-ink-soft">
        标签为团队共用，可贴在任意项目的任务上，用于筛选与分组。
        {!isAdmin && "（仅团队管理员可增删改）"}
      </p>

      {isAdmin && <NewLabelForm teamId={teamId} />}

      {list.length === 0 ? (
        <p className="text-sm text-ink-faint">尚无标签。</p>
      ) : (
        <ul className="space-y-2">
          {list.map((l) => (
            <LabelRow
              key={l.id}
              teamId={teamId}
              label={l}
              usage={usage.get(l.id) ?? 0}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: 团队列表页加入口**

改 `src/app/(app)/teams/page.tsx`，在「成员管理」那枚 `<Link>` 之后加：

```tsx
                <Link href={`/teams/${t.id}/labels`} className="ac-btn-ghost">
                  标签
                </Link>
```

- [ ] **Step 5: 起大营目验**

```bash
npm run dev
```

浏览 `http://localhost:3000/teams` → 点某团队的「标签」→ 以 admin 身份新建「论文 / green」，改名换色，再删除。
Expected: 三样操作皆生效；以非 admin 账号访问同页，看不到新建表单与编辑/删除按钮。

- [ ] **Step 6: 提交**

```bash
git add "src/app/(app)/teams/[teamId]/labels" "src/app/(app)/teams/page.tsx"
git commit -m "feat: 团队标签管理页"
```

---

## Task 9: 筛选栏与看板分组接线

**Files:**
- Create: `src/app/(app)/projects/[projectId]/filter-bar.tsx`
- Modify: `src/app/(app)/projects/[projectId]/board.tsx`（全文替换）
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`

- [ ] **Step 1: 写筛选栏组件**

创建 `src/app/(app)/projects/[projectId]/filter-bar.tsx`：

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  parseFilters,
  serializeFilters,
  type BoardFilters,
  type GroupBy,
} from "@/lib/board-filters";

type Option = { id: string; name: string };

const GROUP_LABEL: Record<GroupBy, string> = {
  status: "状态",
  assignee: "指派人",
  priority: "优先级",
  milestone: "里程碑",
};

const PRIORITY_OPTIONS: Option[] = [
  { id: "high", name: "高" },
  { id: "medium", name: "中" },
  { id: "low", name: "低" },
];

export function FilterBar({
  members,
  milestones,
  labels,
  visible,
  total,
}: {
  members: Option[];
  milestones: Option[];
  labels: Option[];
  visible: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(new URLSearchParams(searchParams.toString()));

  // 筛选态写入 URL：可分享、可刷新保持、可后退。scroll:false 免得跳回页首。
  function push(next: BoardFilters) {
    const qs = serializeFilters(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function toggle(key: "assignee" | "priority" | "label" | "milestone", id: string) {
    const cur = filters[key];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    push({ ...filters, [key]: next });
  }

  const dirty =
    filters.assignee.length > 0 ||
    filters.priority.length > 0 ||
    filters.label.length > 0 ||
    filters.milestone.length > 0 ||
    filters.overdue;

  return (
    <div className="space-y-2 rounded-xl border border-line bg-sunken p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Group name="指派人">
          {[...members, { id: "none", name: "未指派" }].map((m) => (
            <Chip
              key={m.id}
              on={filters.assignee.includes(m.id)}
              onClick={() => toggle("assignee", m.id)}
            >
              {m.name}
            </Chip>
          ))}
        </Group>

        <Group name="优先级">
          {PRIORITY_OPTIONS.map((p) => (
            <Chip
              key={p.id}
              on={filters.priority.includes(p.id)}
              onClick={() => toggle("priority", p.id)}
            >
              {p.name}
            </Chip>
          ))}
        </Group>

        {labels.length > 0 && (
          <Group name="标签">
            {labels.map((l) => (
              <Chip
                key={l.id}
                on={filters.label.includes(l.id)}
                onClick={() => toggle("label", l.id)}
              >
                {l.name}
              </Chip>
            ))}
          </Group>
        )}

        {milestones.length > 0 && (
          <Group name="里程碑">
            {[...milestones, { id: "none", name: "无里程碑" }].map((m) => (
              <Chip
                key={m.id}
                on={filters.milestone.includes(m.id)}
                onClick={() => toggle("milestone", m.id)}
              >
                {m.name}
              </Chip>
            ))}
          </Group>
        )}

        <Chip on={filters.overdue} onClick={() => push({ ...filters, overdue: !filters.overdue })}>
          仅看逾期
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <span className="text-xs font-medium text-ink-soft">分组依据</span>
        <select
          value={filters.group}
          onChange={(e) => push({ ...filters, group: e.target.value as GroupBy })}
          className="ac-field w-auto py-1 text-sm"
        >
          {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">
          显示 {visible} / {total} 个任务
        </span>
        {dirty && (
          <button
            type="button"
            onClick={() =>
              push({
                ...filters,
                assignee: [],
                priority: [],
                label: [],
                milestone: [],
                overdue: false,
              })
            }
            className="text-xs text-ink-faint underline hover:text-primary"
          >
            清空筛选
          </button>
        )}
      </div>
    </div>
  );
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-medium text-ink-soft">{name}</span>
      {children}
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`ac-badge transition ${
        on ? "bg-primary text-white" : "bg-surface text-ink-soft hover:bg-primary-soft"
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: 全文替换 `board.tsx`**

```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { deriveColumns, type BoardColumn, type ColumnPatch } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
};

function Column({
  column,
  tasks,
  projectId,
  canWrite,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  projectId: string;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-40 w-72 shrink-0 space-y-2 rounded-xl border border-line p-3 transition-colors ${
        isOver ? "bg-primary-soft" : "bg-sunken"
      }`}
    >
      <h3 className={`flex items-center gap-2 text-sm font-semibold ${column.tone}`}>
        {column.label}
        <span className="ac-badge bg-surface text-ink-soft">{tasks.length}</span>
      </h3>
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          projectId={projectId}
          canWrite={canWrite}
          members={members}
          milestones={milestones}
          allTasks={allTasks}
          allLabels={allLabels}
          dependencies={dependencies}
        />
      ))}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, ...move.patch } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const columns = deriveColumns(groupBy, { members, milestones });

  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;
    const column = columns.find((c) => c.key === String(over));
    const task = optimisticTasks.find((t) => t.id === taskId);
    // 已在目标列则无须提交
    if (!column || !task || column.matches(task)) return;

    startTransition(async () => {
      setError(null);
      moveOptimistic({ taskId, patch: column.patch });
      const res = await moveTaskAction({ taskId, projectId, patch: column.patch });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <DndContext id={`board-${projectId}`} sensors={sensors} onDragEnd={handleDragEnd}>
      {error && <p className="text-sm text-high">{error}</p>}
      {/* 列数随分组维度而变，故横向滚动而非固定三栏 */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={optimisticTasks.filter((t) => col.matches(t))}
            projectId={projectId}
            canWrite={canWrite}
            members={members}
            milestones={milestones}
            allTasks={allTasks}
            allLabels={allLabels}
            dependencies={dependencies}
          />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 3: 改 `page.tsx`——取标签、解析筛选、渲染筛选栏**

顶部 import 追加：

```ts
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { FilterBar } from "./filter-bar";
```

函数签名改为同时接收 `searchParams`：

```tsx
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
```

四路并发取数改为五路：

```tsx
  const [projectMilestones, projectTasks, members, dependencies, teamLabels] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    listTeamMembers(project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, project.teamId),
  ]);
```

在 `const canWrite = ...` 之前插入筛选计算（深链参数 `?task=` 会被 `parseFilters` 自行忽略）：

```tsx
  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  // 「今日」在服务端按本地时区取 YYYY-MM-DD，随后仅作字符串比较
  const today = new Date().toLocaleDateString("sv-SE");
  const visibleTasks = applyFilters(projectTasks, filters, today);
```

看板一节整段替换为：

```tsx
      <section className="space-y-3">
        <h2 className="font-medium text-ink">看板</h2>
        <FilterBar
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          labels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          visible={visibleTasks.length}
          total={projectTasks.length}
        />
        <Board
          projectId={projectId}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
          }))}
          canWrite={canWrite}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          allLabels={teamLabels.map((l) => ({ id: l.id, name: l.name }))}
          dependencies={dependencies}
        />
      </section>
```

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 仅报 `task-card.tsx` 缺 `allLabels` 属性——Task 10 补齐。

- [ ] **Step 5: 提交**

```bash
git add "src/app/(app)/projects/[projectId]/filter-bar.tsx" "src/app/(app)/projects/[projectId]/board.tsx" "src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat: 项目页筛选栏与看板四维度分组"
```

---

## Task 10: 任务卡显示标签、弹窗内多选标签

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/task-card.tsx`

- [ ] **Step 1: 加 `allLabels` 入参并在卡面显示标签**

顶部 import 追加：

```ts
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
```

`TaskCard` 的参数类型加一项 `allLabels: Option[];`，解构中加 `allLabels`。

在卡面优先级徽章所在那个 `</p>` 之后插入（至多显示 3 枚，余者折为 +N）：

```tsx
        {task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
              >
                {l.name}
              </span>
            ))}
            {task.labels.length > 3 && (
              <span className="text-xs text-ink-faint">+{task.labels.length - 3}</span>
            )}
          </p>
        )}
```

`TaskCard` 内渲染 `<EditModal ... />` 处补传 `allLabels={allLabels}`。

- [ ] **Step 2: 弹窗内加标签多选**

`EditModal` 参数类型加 `allLabels: Option[];`，解构中加 `allLabels`。

在「后置任务（可多选）」那个 `<Field>` **之前**插入：

```tsx
          {allLabels.length > 0 && (
            <Field label="标签（可多选）">
              <select
                multiple
                name="labelIds"
                defaultValue={task.labels.map((l) => l.id)}
                className="ac-field text-sm"
                size={Math.min(4, Math.max(2, allLabels.length))}
              >
                {allLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
```

标签随任务保存一并提交（`updateTaskAction` 已于 Task 7 接收 `labelIds`），无须另加按钮。

- [ ] **Step 3: 类型检查、lint 与构建**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: 三者皆无错。

- [ ] **Step 4: 起大营目验**

```bash
npm run dev
```

浏览某项目页，逐项验：

1. 编辑任务 → 选两枚标签 → 保存 → 卡面出现标签胶囊
2. 筛选栏点某标签 → 只剩带该标签的任务，URL 出现 `label=<uuid>`
3. 刷新页面 → 筛选态仍在
4. 分组依据切到「指派人」→ 列变为每成员一列 + 未指派
5. 把卡片拖到另一成员的列 → 负责人随之改变，刷新后仍是
6. 分组切到「优先级」→ 拖到「高」列 → 优先级升为高

- [ ] **Step 5: 提交**

```bash
git add "src/app/(app)/projects/[projectId]/task-card.tsx"
git commit -m "feat: 任务卡与编辑弹窗支持标签"
```

---

## Task 11: 全线验收与文档同步

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-20-agilecampus-labels-filters-design.md`

- [ ] **Step 1: 跑全量测试**

```bash
npm test
```

Expected: 全绿。若 `agent-snapshot.test.ts` 或 `agent-tools.test.ts` 因任务对象多出 `labels` 字段而失败，把该断言的 `toEqual` 改为 `toMatchObject`，勿改 `labels` 设计。

- [ ] **Step 2: 跑 lint 与构建**

```bash
npm run lint && npm run build
```

Expected: 皆无错。

- [ ] **Step 3: teacher 只读验收**

以 teacher 角色账号登录，浏览项目页。
Expected：无「编辑」按钮、卡片不可拖动（`useDraggable` 的 `disabled: !canWrite`）；即便伪造请求，`moveTaskAction` 亦因 `updateTask` 内 `requireTaskWrite` 而被拒。

- [ ] **Step 4: 既有阵线未伤**

浏览 `/projects/[id]/timeline` 甘特图、`/projects` 总览、项目页 AI 助手对话。
Expected: 行为一如往昔。

- [ ] **Step 5: 更新 README**

路由表中 `/teams/[teamId]/resources` 一行之后插入：

```markdown
| `/teams/[teamId]/labels` | 团队标签管理（admin 增删改，成员只读） |
```

「功能特性」的「项目看板」一条末尾补上 `+ 标签筛选与四维度分组`。

- [ ] **Step 6: 同步修订设计文档的两处偏离**

改 `docs/superpowers/specs/2026-08-20-agilecampus-labels-filters-design.md`：

1. §3 的 schema 代码块中，把
   `uniqueIndex("labels_team_name_unique").on(t.teamId, sql\`lower(${t.name})\`)`
   改为 `uniqueIndex("labels_team_name_unique").on(t.teamId, t.name)`；
   并把「决策记录」第三条改为：唯一索引建在普通两列，大小写不敏感去重由服务层 `lower()` 查询承担，以避开 drizzle-kit push 对表达式索引 diff 的不稳。
2. §7 末段删去「新增 `setTaskLabelsAction`」一句，改为：标签随 `updateTaskAction` 的 `labelIds` 字段一并提交，同构于既有 `successorIds` 之形制。

- [ ] **Step 7: 提交**

```bash
git add README.md docs/superpowers/specs/2026-08-20-agilecampus-labels-filters-design.md
git commit -m "docs: README 与设计文档同步标签与筛选分组"
```

---

## 完工验收标准

对照设计文档 §9 逐项核验：

1. `npm test` 全绿，含新增 `tests/label.test.ts`（21 例）与 `tests/board-filters.test.ts`（19 例）
2. `npm run lint` 与 `npm run build` 无错
3. admin 可在 `/teams/[teamId]/labels` 增删改标签，非 admin 只读
4. 项目页可按指派人 / 优先级 / 标签 / 里程碑 / 逾期五维筛选，刷新后保持，URL 可分享
5. 看板分组可在状态 · 指派人 · 优先级 · 里程碑四维间切换，任一分组下拖拽皆落库
6. teacher 在项目页无写入入口，伪造拖拽请求被服务端拒绝
7. 甘特、AI 助手、Agent API、飞书通知行为不变
