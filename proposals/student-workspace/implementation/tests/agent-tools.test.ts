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
