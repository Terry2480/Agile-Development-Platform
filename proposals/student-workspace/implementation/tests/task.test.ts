import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
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

  it("patch 夹带越权字段（如 projectId）不会被写入", async () => {
    const { owner, team, student, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一项目" });
    const t = await createTask(student.id, project.id, { title: "任务" });
    const evil = { status: "done", projectId: other.id, sortOrder: -1 } as Parameters<typeof updateTask>[2];
    const updated = await updateTask(student.id, t.id, evil);
    expect(updated.status).toBe("done");
    expect(updated.projectId).toBe(project.id);  // 未被挪走
    expect(updated.sortOrder).toBe(t.sortOrder); // 未被篡改
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

describe("任务 startDate（时间线地基）", () => {
  beforeEach(resetDb);

  it("createTask 可存起始日，listProjectTasks 回读", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, {
      title: "实验一",
      startDate: "2026-07-01",
      dueDate: "2026-07-08",
    });
    expect(t.startDate).toBe("2026-07-01");
    const [row] = await listProjectTasks(student.id, project.id);
    expect(row.startDate).toBe("2026-07-01");
    expect(row.dueDate).toBe("2026-07-08");
  });

  it("updateTask 可改起始日，可清空为 null", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "实验" });
    const u1 = await updateTask(student.id, t.id, { startDate: "2026-07-02" });
    expect(u1.startDate).toBe("2026-07-02");
    const u2 = await updateTask(student.id, t.id, { startDate: null });
    expect(u2.startDate).toBeNull();
  });
});

describe("createTask 记录创建者", () => {
  beforeEach(resetDb);

  it("createdById = 操作者", async () => {
    const { student, project } = await scene();
    const t = await createTask(student.id, project.id, { title: "筹备粮草" });

    const [row] = await db
      .select({ createdById: tasks.createdById })
      .from(tasks)
      .where(eq(tasks.id, t.id));
    expect(row.createdById).toBe(student.id);
  });
});
