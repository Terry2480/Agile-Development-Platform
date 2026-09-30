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
    await setTaskSuccessors(student.id, b.id, [a.id]);
    await expect(setTaskSuccessors(student.id, a.id, [b.id])).rejects.toThrow("循环");
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
