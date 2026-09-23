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
