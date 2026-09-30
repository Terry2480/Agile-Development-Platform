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
