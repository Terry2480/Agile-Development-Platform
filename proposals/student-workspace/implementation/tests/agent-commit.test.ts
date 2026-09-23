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
    await updateTask(student.id, t.id, { status: "done" });
    const r = await commitDraft(student.id, project.id, "update_tasks", {
      updates: [
        { taskId: t.id, updatedAt: "2000-01-01T00:00:00.000Z", patch: { status: "doing" } },
      ],
    });
    expect(r.committed).toBe(0);
    expect(r.conflicts).toEqual([t.id]);
    const [after] = await listProjectTasks(student.id, project.id);
    expect(after.status).toBe("done");
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

describe("commitDraft 事务化", () => {
  beforeEach(resetDb);

  it("decompose 中途非法 milestoneId → 整批回滚（无残留）", async () => {
    const { owner, project } = await scene();
    // 第 2 个任务 milestoneId 非法 → validateMilestone 抛错 → 整批回滚
    await expect(
      commitDraft(owner.id, project.id, "decompose_tasks", {
        tasks: [
          { title: "合法一" },
          { title: "非法二", milestoneId: "00000000-0000-0000-0000-000000000000" },
        ],
      }),
    ).rejects.toThrow();

    const after = await listProjectTasks(owner.id, project.id);
    expect(after).toHaveLength(0); // 「合法一」不得残留
  });
});
