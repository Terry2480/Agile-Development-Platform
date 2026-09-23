# AgileCampus 作战图二：骨架（项目 + 里程碑 + 任务 + 看板）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在图一地基之上建成项目管理骨架——项目/里程碑/任务三表、项目列表与创建、项目详情页（里程碑 + 看板三列拖拽 + 任务 CRUD），全部经 TDD 验证。

**Architecture:** 沿用图一分层——schema 在 `src/db/schema.ts` 追加；业务纯函数在 `src/lib/{project,task}.ts`（TDD）；权限经 `getTeamMembership`/`requireTeamRole` 收敛，每个 server action 入口自校验（军法）；页面为 RSC + 少量客户端组件；看板拖拽用 @dnd-kit/core + useOptimistic。

**Tech Stack:** 图一既有栈 + `@dnd-kit/core`（拖拽）

**设计文档：** `docs/superpowers/specs/2026-07-02-agilecampus-mvp-design.md`（第 2 节"骨架"、第 4 节数据模型、第 5 节权限）

**权限规则（依设计文档 §5 严格执行）：**
| 操作 | admin | teacher | student |
|---|---|---|---|
| 查看项目/里程碑/任务 | ✓ | ✓ | ✓ |
| 创建项目、里程碑 | ✓ | ✗ | ✗ |
| 建任务、改任务、拖看板、删任务 | ✓ | ✗ | ✓ |

**简化备案（写入 BACKLOG，不在本图实现）：** 不设项目级成员表——团队成员即可见团队内所有项目（"参与的项目"从宽解释）；teacher 反馈/评论后置；看板列内手动排序后置（sort_order 字段先建，拖拽仅改状态、落列尾）。

---

## 文件结构总览

```
src/db/schema.ts                                  # 追加 projects / milestones / tasks + 四枚举
src/lib/project.ts                                # createProject / listTeamProjects / getProjectForUser
                                                  # / createMilestone / listProjectMilestones
src/lib/task.ts                                   # createTask / updateTask / deleteTask / listProjectTasks
src/app/(app)/teams/[teamId]/projects/page.tsx    # 项目列表
src/app/(app)/teams/[teamId]/projects/actions.ts  # createProjectAction
src/app/(app)/teams/[teamId]/projects/project-form.tsx
src/app/(app)/teams/page.tsx                      # 修改：每团队加"项目"链接
src/app/(app)/projects/[projectId]/page.tsx       # 项目详情（里程碑 + 看板 + 表单装配）
src/app/(app)/projects/[projectId]/actions.ts     # 任务/里程碑相关 actions
src/app/(app)/projects/[projectId]/board.tsx      # 看板客户端组件（@dnd-kit + useOptimistic）
src/app/(app)/projects/[projectId]/task-card.tsx  # 任务卡片（含编辑/删除表单）
src/app/(app)/projects/[projectId]/new-task-form.tsx
src/app/(app)/projects/[projectId]/milestone-section.tsx
tests/project.test.ts
tests/task.test.ts
tests/helpers.ts                                  # 修改：TRUNCATE 追加三表
```

约定沿用图一：`@/`→src、AppError/ForbiddenError、23505 用 `isUniqueViolation`、所有 server action 自行 `auth()`。

---

### Task 1: Schema 扩展（projects / milestones / tasks）

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `tests/helpers.ts`

- [ ] **Step 1: 在 `src/db/schema.ts` 追加（import 处补 `date`, `doublePrecision`, `index`）**

```ts
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"]);
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_team_idx").on(t.teamId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: date("target_date"),
    status: milestoneStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
  ],
);
```

- [ ] **Step 2: `tests/helpers.ts` 的 TRUNCATE 追加新表（子表在前）**

```ts
export async function resetDb() {
  await db.execute(
    sql`TRUNCATE tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 3: push 两库并验证**

```bash
npm run db:push
npm run db:push:test
docker compose exec db psql -U agilecampus -d agilecampus -c '\dt' | grep -E 'projects|milestones|tasks' && echo SCHEMA-OK
docker compose exec db psql -U agilecampus -d agilecampus_test -c '\dt' | grep tasks && echo TEST-SCHEMA-OK
npx tsc --noEmit && npm test
```

Expected: SCHEMA-OK、TEST-SCHEMA-OK、tsc 干净、22 tests 不回归。

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts tests/helpers.ts
git commit -m "feat: schema 扩展——projects/milestones/tasks 三表与枚举"
```

---

### Task 2: lib/project.ts（TDD）

**Files:**
- Create: `tests/project.test.ts`
- Create: `src/lib/project.ts`

- [ ] **Step 1: 写失败测试 `tests/project.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import {
  createProject,
  listTeamProjects,
  getProjectForUser,
  createMilestone,
  listProjectMilestones,
} from "@/lib/project";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

// 常用布景：owner(admin) 建团队，student 加入，outsider 在野
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  return { owner, team, student, outsider };
}

describe("createProject", () => {
  beforeEach(resetDb);

  it("admin 可创建项目，默认 active", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, {
      name: "赤壁演习",
      description: "冬季学期项目",
      startDate: "2026-09-01",
      endDate: "2027-01-15",
    });
    expect(p.name).toBe("赤壁演习");
    expect(p.status).toBe("active");
    expect(p.teamId).toBe(team.id);
  });

  it("student 建项目被拒（仅 admin）", async () => {
    const { team, student } = await scene();
    await expect(
      createProject(student.id, team.id, { name: "私设项目" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("listTeamProjects", () => {
  beforeEach(resetDb);

  it("团队成员可列出团队项目", async () => {
    const { owner, team, student } = await scene();
    await createProject(owner.id, team.id, { name: "甲计划" });
    await createProject(owner.id, team.id, { name: "乙计划" });
    const list = await listTeamProjects(student.id, team.id);
    expect(list).toHaveLength(2);
  });

  it("非成员被拒", async () => {
    const { owner, team, outsider } = await scene();
    await createProject(owner.id, team.id, { name: "甲计划" });
    await expect(listTeamProjects(outsider.id, team.id)).rejects.toThrow("没有权限");
  });
});

describe("getProjectForUser", () => {
  beforeEach(resetDb);

  it("成员取得项目与自身角色", async () => {
    const { owner, team, student } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    const access = await getProjectForUser(student.id, p.id);
    expect(access?.project.id).toBe(p.id);
    expect(access?.role).toBe("student");
  });

  it("非成员得 null（不泄露存在性）", async () => {
    const { owner, team, outsider } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    expect(await getProjectForUser(outsider.id, p.id)).toBeNull();
  });

  it("项目不存在得 null", async () => {
    const { owner } = await scene();
    expect(
      await getProjectForUser(owner.id, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("milestones", () => {
  beforeEach(resetDb);

  it("admin 可建里程碑并列出", async () => {
    const { owner, team } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    const m = await createMilestone(owner.id, p.id, {
      title: "中期答辩",
      targetDate: "2026-11-15",
    });
    expect(m.status).toBe("open");
    const list = await listProjectMilestones(owner.id, p.id);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("中期答辩");
  });

  it("student 建里程碑被拒", async () => {
    const { owner, team, student } = await scene();
    const p = await createProject(owner.id, team.id, { name: "甲计划" });
    await expect(
      createMilestone(student.id, p.id, { title: "私设节点" }),
    ).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/project.test.ts
```

Expected: FAIL（`@/lib/project` 不存在）。必须真跑。

- [ ] **Step 3: 实现 `src/lib/project.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, projects } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { getTeamMembership, requireTeamRole } from "./team";

export async function createProject(
  actorId: string,
  teamId: string,
  input: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
  },
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const [project] = await db
    .insert(projects)
    .values({
      teamId,
      name: input.name,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
    })
    .returning();
  return project;
}

export async function listTeamProjects(actorId: string, teamId: string) {
  await requireTeamRole(actorId, teamId, ["admin", "teacher", "student"]);
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.createdAt));
}

// 页面/任务层的访问收敛点：项目不存在或非团队成员一律 null，不泄露存在性
export async function getProjectForUser(actorId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const membership = await getTeamMembership(actorId, project.teamId);
  if (!membership) return null;
  return { project, role: membership.role };
}

export async function createMilestone(
  actorId: string,
  projectId: string,
  input: { title: string; targetDate?: string },
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || access.role !== "admin") throw new ForbiddenError();
  const [milestone] = await db
    .insert(milestones)
    .values({ projectId, title: input.title, targetDate: input.targetDate })
    .returning();
  return milestone;
}

export async function listProjectMilestones(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(milestones.targetDate);
}
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/project.test.ts src/lib/project.ts
git commit -m "feat: 项目与里程碑业务层（权限收敛）"
```

Expected: 全量 31 passed（22+9）。

---

### Task 3: lib/task.ts（TDD）

**Files:**
- Create: `tests/task.test.ts`
- Create: `src/lib/task.ts`

- [ ] **Step 1: 写失败测试 `tests/task.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask, updateTask, deleteTask, listProjectTasks } from "@/lib/task";
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

describe("createTask", () => {
  beforeEach(resetDb);

  it("student 可建任务，默认 todo/medium，含负责人与截止日", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, {
      title: "撰写调研问卷",
      assigneeId: student.id,
      dueDate: "2026-10-01",
    });
    expect(t.status).toBe("todo");
    expect(t.priority).toBe("medium");
    expect(t.assigneeId).toBe(student.id);
    expect(t.sortOrder).toBeGreaterThan(0);
  });

  it("teacher 建任务被拒（只读角色）", async () => {
    const { teacher, project } = await scene();
    await expect(
      createTask(teacher.id, project.id, { title: "越权任务" }),
    ).rejects.toThrow("没有权限");
  });

  it("非成员建任务被拒", async () => {
    const { outsider, project } = await scene();
    await expect(
      createTask(outsider.id, project.id, { title: "越权任务" }),
    ).rejects.toThrow("没有权限");
  });

  it("负责人必须是团队成员", async () => {
    const { student, outsider, project } = await scene();
    await expect(
      createTask(student.id, project.id, { title: "任务", assigneeId: outsider.id }),
    ).rejects.toThrow("负责人不是团队成员");
  });

  it("里程碑必须属于本项目", async () => {
    const { owner, team, student, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const m = await createMilestone(owner.id, other.id, { title: "别家节点" });
    await expect(
      createTask(student.id, project.id, { title: "任务", milestoneId: m.id }),
    ).rejects.toThrow("里程碑不属于该项目");
  });
});

describe("updateTask", () => {
  beforeEach(resetDb);

  it("student 可改状态与负责人", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "任务" });
    const updated = await updateTask(student.id, t.id, {
      status: "doing",
      assigneeId: owner.id,
    });
    expect(updated.status).toBe("doing");
    expect(updated.assigneeId).toBe(owner.id);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(t.updatedAt.getTime());
  });

  it("teacher 改任务被拒", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "任务" });
    await expect(updateTask(teacher.id, t.id, { status: "done" })).rejects.toThrow(
      "没有权限",
    );
  });

  it("任务不存在抛可展示错误", async () => {
    const { student } = await scene();
    await expect(
      updateTask(student.id, "00000000-0000-0000-0000-000000000000", { status: "done" }),
    ).rejects.toThrow("任务不存在");
  });
});

describe("deleteTask / listProjectTasks", () => {
  beforeEach(resetDb);

  it("student 可删任务；列表随之减少且带负责人姓名", async () => {
    const { student, project } = await scene();
    const t1 = await createTask(student.id, project.id, {
      title: "甲",
      assigneeId: student.id,
    });
    await createTask(student.id, project.id, { title: "乙" });

    let list = await listProjectTasks(student.id, project.id);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.id === t1.id)?.assigneeName).toBe("student");

    await deleteTask(student.id, t1.id);
    list = await listProjectTasks(student.id, project.id);
    expect(list).toHaveLength(1);
  });

  it("teacher 可看列表但不可删", async () => {
    const { student, teacher, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "甲" });
    expect(await listProjectTasks(teacher.id, project.id)).toHaveLength(1);
    await expect(deleteTask(teacher.id, t.id)).rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/task.test.ts
```

Expected: FAIL（`@/lib/task` 不存在）。

- [ ] **Step 3: 实现 `src/lib/task.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  milestones,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";
import { getProjectForUser } from "./project";

// 任务写操作角色：admin + student（teacher 只读，设计文档 §5）
const TASK_WRITE_ROLES = ["admin", "student"];

async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

async function requireTaskWrite(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (!TASK_WRITE_ROLES.includes(access.role)) throw new ForbiddenError();
  return access;
}

async function validateAssignee(teamId: string, assigneeId: string) {
  const membership = await getTeamMembership(assigneeId, teamId);
  if (!membership) throw new AppError("负责人不是团队成员");
}

async function validateMilestone(projectId: string, milestoneId: string) {
  const [m] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)));
  if (!m) throw new AppError("里程碑不属于该项目");
}

export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
  },
) {
  const access = await requireTaskWrite(actorId, projectId);
  if (input.assigneeId) await validateAssignee(access.project.teamId, input.assigneeId);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);

  const [task] = await db
    .insert(tasks)
    .values({
      projectId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      priority: input.priority ?? "medium",
      sortOrder: Date.now(),
    })
    .returning();
  return task;
}

export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
  },
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);
  if (patch.assigneeId) await validateAssignee(access.project.teamId, patch.assigneeId);
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);

  const [updated] = await db
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  return updated;
}

export async function deleteTask(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, task.projectId);
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      milestoneId: tasks.milestoneId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);
}
```

注意：`updateTask`/`deleteTask` 中"任务不存在"先于权限检查返回，对非成员泄露任务 uuid 存在性——uuid 不可枚举且消息不含内容，MVP 可接受，已列 BACKLOG 备案；照计划写，勿自行改动测试语义。

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test
npx tsc --noEmit && npm run lint
git add tests/task.test.ts src/lib/task.ts
git commit -m "feat: 任务业务层——CRUD 与角色/归属校验"
```

Expected: 全量 41 passed（31+10）。

---

### Task 4: 项目列表页 + 团队页入口

**Files:**
- Create: `src/app/(app)/teams/[teamId]/projects/actions.ts`
- Create: `src/app/(app)/teams/[teamId]/projects/page.tsx`
- Create: `src/app/(app)/teams/[teamId]/projects/project-form.tsx`
- Modify: `src/app/(app)/teams/page.tsx`（每团队行加"项目"链接）

- [ ] **Step 1: 创建 `actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1, "请填写项目名称"),
  description: z.string().trim().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type FormState = { error: string } | null;

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse({
    ...raw,
    description: raw.description || undefined,
    startDate: raw.startDate || undefined,
    endDate: raw.endDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createProject(session.user.id, parsed.data.teamId, {
      name: parsed.data.name,
      description: parsed.data.description,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建项目" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/projects`);
  return null;
}
```

- [ ] **Step 2: 创建 `page.tsx`**

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeamMembership } from "@/lib/team";
import { listTeamProjects } from "@/lib/project";
import { ProjectForm } from "./project-form";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(teamId).success) notFound();

  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const projects = await listTeamProjects(session.user.id, teamId);
  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">项目</h1>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="rounded border p-3">
            <Link href={`/projects/${p.id}`} className="font-medium underline">
              {p.name}
            </Link>
            <span className="ml-2 text-xs text-gray-500">{p.status}</span>
            {(p.startDate || p.endDate) && (
              <span className="ml-2 text-xs text-gray-400">
                {p.startDate ?? "?"} ~ {p.endDate ?? "?"}
              </span>
            )}
            {p.description && (
              <p className="mt-1 text-sm text-gray-600">{p.description}</p>
            )}
          </li>
        ))}
        {projects.length === 0 && (
          <li className="text-sm text-gray-500">
            暂无项目{isAdmin ? "，在下方创建第一个。" : "。"}
          </li>
        )}
      </ul>
      {isAdmin && <ProjectForm teamId={teamId} />}
    </main>
  );
}
```

- [ ] **Step 3: 创建 `project-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { createProjectAction, type FormState } from "./actions";

export function ProjectForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createProjectAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-2 rounded border p-4">
      <h2 className="font-medium">创建项目</h2>
      <input type="hidden" name="teamId" value={teamId} />
      <input name="name" placeholder="项目名称" className="w-full rounded border p-2" />
      <textarea
        name="description"
        placeholder="项目描述（可选）"
        className="w-full rounded border p-2"
        rows={2}
      />
      <div className="flex gap-2">
        <label className="flex-1 text-sm text-gray-500">
          开始日期
          <input type="date" name="startDate" className="w-full rounded border p-2" />
        </label>
        <label className="flex-1 text-sm text-gray-500">
          结束日期
          <input type="date" name="endDate" className="w-full rounded border p-2" />
        </label>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: 修改 `src/app/(app)/teams/page.tsx`——团队行右侧"成员管理"链接处改为两链接**

```tsx
<div className="flex gap-3">
  <Link href={`/teams/${t.id}/projects`} className="text-sm underline">
    项目
  </Link>
  <Link href={`/teams/${t.id}/members`} className="text-sm underline">
    成员管理
  </Link>
</div>
```

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit && npm test && npm run lint
# 端到端：admin 登录 → /teams 出现"项目"链接 → 建项目成功入列表；
# student 登录同页无创建表单（权限拒绝路径 lib 测试已覆盖）
git add "src/app/(app)/teams"
git commit -m "feat: 项目列表页与创建（admin）"
```

---

### Task 5: 项目详情页（数据装配 + 里程碑区 + 静态三列）

**Files:**
- Create: `src/app/(app)/projects/[projectId]/page.tsx`
- Create: `src/app/(app)/projects/[projectId]/actions.ts`
- Create: `src/app/(app)/projects/[projectId]/milestone-section.tsx`
- Create: `src/app/(app)/projects/[projectId]/new-task-form.tsx`

本任务先立静态骨架（三列按状态分组渲染，无拖拽）；拖拽在 Task 6。

- [ ] **Step 1: 创建 `actions.ts`（本任务含 createTaskAction 与 createMilestoneAction；Task 6/7 再追加）**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createTask } from "@/lib/task";
import { createMilestone } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;

const createTaskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写任务标题"),
  assigneeId: z.uuid().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export async function createTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    dueDate: raw.dueDate || undefined,
    milestoneId: raw.milestoneId || undefined,
    priority: raw.priority || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    await createTask(session.user.id, projectId, input);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}

const createMilestoneSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写里程碑标题"),
  targetDate: z.string().optional(),
});

export async function createMilestoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = createMilestoneSchema.safeParse({
    ...raw,
    targetDate: raw.targetDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createMilestone(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      targetDate: parsed.data.targetDate,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建里程碑" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
```

- [ ] **Step 2: 创建 `page.tsx`**

```tsx
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teamMembers, users } from "@/db/schema";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";

const COLUMNS = [
  { key: "todo", label: "待办" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" },
] as const;

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [projectMilestones, projectTasks, members] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    db
      .select({ id: users.id, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, project.teamId)),
  ]);

  const canWrite = role === "admin" || role === "student";
  const isAdmin = role === "admin";

  return (
    <main className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-gray-600">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-400">
          {project.startDate ?? "?"} ~ {project.endDate ?? "?"} · {project.status}
        </p>
      </header>

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin}
      />

      <section className="space-y-3">
        <h2 className="font-medium">看板</h2>
        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.key} className="space-y-2 rounded border bg-gray-50 p-3">
              <h3 className="text-sm font-medium text-gray-600">{col.label}</h3>
              {projectTasks
                .filter((t) => t.status === col.key)
                .map((t) => (
                  <div key={t.id} className="rounded border bg-white p-2 text-sm">
                    <p className="font-medium">{t.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {t.assigneeName ?? "未分配"}
                      {t.dueDate && ` · ${t.dueDate}`}
                      {` · ${t.priority}`}
                    </p>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          members={members}
          milestones={projectMilestones.map((m) => ({ id: m.id, title: m.title }))}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: 创建 `milestone-section.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { createMilestoneAction, type FormState } from "./actions";

type Milestone = {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
};

export function MilestoneSection({
  projectId,
  milestones,
  isAdmin,
}: {
  projectId: string;
  milestones: Milestone[];
  isAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createMilestoneAction,
    null,
  );

  return (
    <section className="space-y-2">
      <h2 className="font-medium">里程碑</h2>
      <ul className="flex flex-wrap gap-2">
        {milestones.map((m) => (
          <li key={m.id} className="rounded border px-3 py-1 text-sm">
            {m.title}
            {m.targetDate && (
              <span className="ml-1 text-xs text-gray-400">{m.targetDate}</span>
            )}
            <span className="ml-1 text-xs text-gray-500">[{m.status}]</span>
          </li>
        ))}
        {milestones.length === 0 && (
          <li className="text-sm text-gray-500">暂无里程碑。</li>
        )}
      </ul>
      {isAdmin && (
        <form action={formAction} className="flex items-end gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="title"
            placeholder="里程碑标题"
            className="rounded border p-2 text-sm"
          />
          <input type="date" name="targetDate" className="rounded border p-2 text-sm" />
          <button
            disabled={pending}
            className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            添加
          </button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        </form>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 创建 `new-task-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { createTaskAction, type FormState } from "./actions";

export function NewTaskForm({
  projectId,
  members,
  milestones,
}: {
  projectId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createTaskAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-2 rounded border p-4">
      <h2 className="font-medium">新建任务</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <input name="title" placeholder="任务标题" className="w-full rounded border p-2" />
      <div className="flex flex-wrap gap-2">
        <select name="assigneeId" defaultValue="" className="rounded border p-2 text-sm">
          <option value="">未分配</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select name="milestoneId" defaultValue="" className="rounded border p-2 text-sm">
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue="medium" className="rounded border p-2 text-sm">
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <input type="date" name="dueDate" className="rounded border p-2 text-sm" />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        disabled={pending}
        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建任务"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit && npm test && npm run lint
# 端到端：admin 建里程碑、建任务（带负责人/里程碑/优先级/截止日）→ 卡片落待办列；
# teacher 登录：无新建任务/里程碑表单，看板只读；
# 非成员访问 /projects/<id> → 404；/projects/not-a-uuid → 404
git add "src/app/(app)/projects"
git commit -m "feat: 项目详情页——里程碑与静态看板三列"
```

---

### Task 6: 看板拖拽（@dnd-kit + useOptimistic）

**Files:**
- Modify: `package.json`（安装 @dnd-kit/core）
- Create: `src/app/(app)/projects/[projectId]/board.tsx`
- Modify: `src/app/(app)/projects/[projectId]/actions.ts`（追加 moveTaskAction）
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`（静态三列替换为 Board）

- [ ] **Step 1: 安装依赖**

```bash
npm install @dnd-kit/core
```

- [ ] **Step 2: `actions.ts` 追加（import 处补 updateTask）**

```ts
const moveTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  status: z.enum(["todo", "doing", "done"]),
});

export async function moveTaskAction(input: {
  taskId: string;
  projectId: string;
  status: "todo" | "doing" | "done";
}): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { error: "参数无效" };

  try {
    await updateTask(session.user.id, parsed.data.taskId, {
      status: parsed.data.status,
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
```

（moveTaskAction 由客户端以对象直接调用，非表单提交，签名不同于 useActionState 型。）

- [ ] **Step 3: 创建 `board.tsx`**

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { moveTaskAction } from "./actions";

export type BoardTask = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  priority: string;
  dueDate: string | null;
  assigneeName: string | null;
};

const COLUMNS = [
  { key: "todo", label: "待办" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

function TaskCard({ task, canWrite }: { task: BoardTask; canWrite: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`rounded border bg-white p-2 text-sm ${
        canWrite ? "cursor-grab" : ""
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <p className="font-medium">{task.title}</p>
      <p className="mt-1 text-xs text-gray-500">
        {task.assigneeName ?? "未分配"}
        {task.dueDate && ` · ${task.dueDate}`}
        {` · ${task.priority}`}
      </p>
    </div>
  );
}

function Column({
  columnKey,
  label,
  tasks,
  canWrite,
}: {
  columnKey: ColumnKey;
  label: string;
  tasks: BoardTask[];
  canWrite: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-40 space-y-2 rounded border p-3 ${
        isOver ? "bg-blue-50" : "bg-gray-50"
      }`}
    >
      <h3 className="text-sm font-medium text-gray-600">
        {label} <span className="text-xs text-gray-400">{tasks.length}</span>
      </h3>
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} canWrite={canWrite} />
      ))}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  canWrite,
}: {
  projectId: string;
  tasks: BoardTask[];
  canWrite: boolean;
}) {
  const [, startTransition] = useTransition();
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; status: ColumnKey }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, status: move.status } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;
    const status = over as ColumnKey;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;

    startTransition(async () => {
      moveOptimistic({ taskId, status });
      await moveTaskAction({ taskId, projectId, status });
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-3 gap-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            columnKey={col.key}
            label={col.label}
            tasks={optimisticTasks.filter((t) => t.status === col.key)}
            canWrite={canWrite}
          />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 4: `page.tsx` 的"看板" section 三列静态渲染替换为：**

```tsx
<Board
  projectId={projectId}
  tasks={projectTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeName: t.assigneeName,
  }))}
  canWrite={canWrite}
/>
```

（顶部 import Board；删除不再使用的 COLUMNS 常量与静态渲染，保持无死代码。）

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit && npm test && npm run lint
# 端到端（Playwright）：拖卡片 待办→进行中——列即时更新（optimistic）、刷新后仍在新列（落库）；
# teacher 拖拽无效（disabled）；查库确认 status 变更
git add package.json package-lock.json "src/app/(app)/projects"
git commit -m "feat: 看板拖拽改状态（@dnd-kit + 乐观更新）"
```

---

### Task 7: 任务编辑与删除（卡片内表单）

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/actions.ts`（追加 updateTaskAction / deleteTaskAction）
- Create: `src/app/(app)/projects/[projectId]/task-card.tsx`（可展开编辑的卡片）
- Modify: `src/app/(app)/projects/[projectId]/board.tsx`（内嵌 TaskCard 移除，改用 task-card.tsx；BoardTask 补 assigneeId/milestoneId；Board/Column 透传 members/milestones）
- Modify: `src/app/(app)/projects/[projectId]/page.tsx`（Board 传参补 members/milestones 与任务新字段）

- [ ] **Step 1: `actions.ts` 追加（import 处补 deleteTask）**

```ts
const updateTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
  title: z.string().trim().min(1, "标题不可为空"),
  assigneeId: z.uuid().optional(),
  milestoneId: z.uuid().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
});

export async function updateTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = updateTaskSchema.safeParse({
    ...raw,
    assigneeId: raw.assigneeId || undefined,
    milestoneId: raw.milestoneId || undefined,
    dueDate: raw.dueDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, projectId, ...patch } = parsed.data;
  try {
    await updateTask(session.user.id, taskId, {
      title: patch.title,
      assigneeId: patch.assigneeId ?? null,
      milestoneId: patch.milestoneId ?? null,
      dueDate: patch.dueDate ?? null,
      priority: patch.priority,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  return null;
}

const deleteTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.uuid(),
});

export async function deleteTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteTask(session.user.id, parsed.data.taskId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除任务" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return null;
}
```

- [ ] **Step 2: 创建 `task-card.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  deleteTaskAction,
  updateTaskAction,
  type FormState,
} from "./actions";
import type { BoardTask } from "./board";

export type Option = { id: string; name: string };

export function TaskCard({
  task,
  projectId,
  canWrite,
  members,
  milestones,
}: {
  task: BoardTask;
  projectId: string;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
}) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateFormAction, updating] = useActionState<FormState, FormData>(
    updateTaskAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState<FormState, FormData>(
    deleteTaskAction,
    null,
  );
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite || editing,
  });

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`rounded border bg-white p-2 text-sm ${isDragging ? "opacity-50" : ""}`}
    >
      <div
        {...listeners}
        {...attributes}
        className={canWrite && !editing ? "cursor-grab" : ""}
      >
        <p className="font-medium">{task.title}</p>
        <p className="mt-1 text-xs text-gray-500">
          {task.assigneeName ?? "未分配"}
          {task.dueDate && ` · ${task.dueDate}`}
          {` · ${task.priority}`}
        </p>
      </div>

      {canWrite && (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="mt-1 text-xs text-gray-400 underline"
        >
          {editing ? "收起" : "编辑"}
        </button>
      )}

      {editing && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <form action={updateFormAction} className="space-y-1">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <input
              name="title"
              defaultValue={task.title}
              className="w-full rounded border p-1 text-xs"
            />
            <select
              name="assigneeId"
              defaultValue={task.assigneeId ?? ""}
              className="w-full rounded border p-1 text-xs"
            >
              <option value="">未分配</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              name="milestoneId"
              defaultValue={task.milestoneId ?? ""}
              className="w-full rounded border p-1 text-xs"
            >
              <option value="">无里程碑</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <select
                name="priority"
                defaultValue={task.priority}
                className="rounded border p-1 text-xs"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
              <input
                type="date"
                name="dueDate"
                defaultValue={task.dueDate ?? ""}
                className="rounded border p-1 text-xs"
              />
            </div>
            {updateState?.error && (
              <p className="text-xs text-red-600">{updateState.error}</p>
            )}
            <button
              disabled={updating}
              className="rounded bg-black px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              保存
            </button>
          </form>
          <form action={deleteFormAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            {deleteState?.error && (
              <p className="text-xs text-red-600">{deleteState.error}</p>
            )}
            <button
              disabled={deleting}
              className="text-xs text-red-600 underline disabled:opacity-50"
            >
              删除任务
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 修改 `board.tsx`**——删内嵌 TaskCard 改 import；`BoardTask` 类型补 `assigneeId: string | null; milestoneId: string | null;`；Board props 增 `members: Option[]`、`milestones: Option[]`（import type Option from "./task-card"）并经 Column 透传给 TaskCard（TaskCard 需要 projectId，一并透传）。

- [ ] **Step 4: 修改 `page.tsx`**——Board 传参补齐：

```tsx
<Board
  projectId={projectId}
  tasks={projectTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeName: t.assigneeName,
    assigneeId: t.assigneeId,
    milestoneId: t.milestoneId,
  }))}
  canWrite={canWrite}
  members={members}
  milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
/>
```

（NewTaskForm 的 milestones prop 结构若与 Option 不一致，统一为 `{id, name}` 或各自适配，以 tsc 通过且无重复定义为准。）

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit && npm test && npm run lint
# 端到端：编辑任务各字段保存即生效；删除任务卡片消失且库中行删除；
# 编辑态卡片不可拖拽；teacher 无编辑按钮
git add "src/app/(app)/projects"
git commit -m "feat: 任务编辑与删除（卡片内表单）"
```

---

### Task 8: 收尾——全量回归、验收、文档

**Files:**
- Modify: `README.md`（路由清单）
- Modify: `docs/BACKLOG.md`（图二简化备案）

- [ ] **Step 1: 全量回归**

```bash
npm test && npm run lint && npm run build
```

Expected: 41 tests 全绿、lint 净、build 成（新增 /teams/[teamId]/projects 与 /projects/[projectId] 路由）。

- [ ] **Step 2: README「技术栈」节后追加「主要路由」节**

```markdown
## 主要路由

- `/teams` 我的团队（创建/加入）
- `/teams/[teamId]/members` 成员管理（admin 改角色）
- `/teams/[teamId]/projects` 项目列表（admin 创建）
- `/projects/[projectId]` 项目详情：里程碑 + 看板拖拽 + 任务管理
```

- [ ] **Step 3: BACKLOG 追加图二备案**

```markdown
## 图二（骨架）简化备案
- 无项目级成员表：团队成员即可见全部团队项目（"参与的项目"从宽）
- 看板列内手动排序未做（sort_order 已建，拖拽仅改状态）
- teacher 反馈/评论功能后置（设计文档原定 MVP 后）
- 里程碑无编辑/关闭入口（仅创建与展示，状态字段已建）
- 项目无编辑/归档入口（status 字段已建）
- updateTask/deleteTask "任务不存在"先于权限返回，对非成员泄露 uuid 存在性（uuid 不可枚举，风险极低）
```

- [ ] **Step 4: 验收清单（对照设计文档第 8 节第 2 条 + 权限矩阵）**

端到端逐项（临时数据带谓词清理，严禁全表 DELETE）：
1. admin 建项目（含起止日）→ 列表可见 → student 视角无创建表单
2. admin 建里程碑 → 项目页里程碑区可见
3. student 建任务（负责人/里程碑/优先级/截止日）→ 落待办列
4. 拖卡片 待办→进行中→已完成：即时更新、刷新不丢、库值正确
5. 编辑任务各字段生效；删除任务消失
6. teacher：全部可见、全部只读（无表单、拖拽无效）
7. 非成员访问 /projects/<id> → 404；/teams/<别队id>/projects → 404
8. 负责人选非团队成员/里程碑跨项目（lib 测试已覆盖，无需页面构造）

- [ ] **Step 5: Commit**

```bash
git add README.md docs/BACKLOG.md
git commit -m "docs: 图二收尾——路由清单与简化备案"
```
