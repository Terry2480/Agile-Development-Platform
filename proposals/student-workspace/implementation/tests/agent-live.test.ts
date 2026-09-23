import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask } from "@/lib/task";
import { buildProjectSnapshot } from "@/lib/agent/snapshot";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

// 真机演武：真实呼叫 DeepSeek，耗额度。无密钥则整阵跳过，故 `npm test` 默认不触达。
// 跑法：export DEEPSEEK_API_KEY=sk-xxx && npx dotenv -e .env.test -- npx vitest run tests/agent-live.test.ts
describe.skipIf(!process.env.DEEPSEEK_API_KEY)("真实 DeepSeek 演武", () => {
  beforeEach(resetDb);

  it("复现陛下截图之输入：帮我新建一个完成ai", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const zhouyu = await makeUser("zhouyu@example.com");
    await joinTeam(zhouyu.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, {
      name: "赤壁演习",
      description: "AI 项目管理助手研发",
    });
    await createMilestone(owner.id, project.id, { title: "中期答辩", targetDate: "2026-09-01" });
    await createTask(owner.id, project.id, { title: "调研现有方案", assigneeId: zhouyu.id });

    const snap = await buildProjectSnapshot(owner.id, project.id);
    console.log("\n======== 快照 ========\n" + snap);

    const r = await runAgentTurn({
      actorId: owner.id,
      projectId: project.id,
      userText: "帮我新建一个完成ai的任务",
    });

    console.log("\n======== 助手回复 ========\n" + r.text);
    console.log("\n======== 工具轨迹 ========\n" + JSON.stringify(r.toolTrace, null, 2));
    console.log("\n======== 草案 ========\n" + JSON.stringify(r.drafts, null, 2));

    expect(r.drafts.length).toBeGreaterThan(0);
  }, 120000);

  it("指派消歧：把调研现有方案指给 zhouyu 并改为进行中", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const zhouyu = await makeUser("zhouyu@example.com");
    await joinTeam(zhouyu.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    await createTask(owner.id, project.id, { title: "调研现有方案" });

    const r = await runAgentTurn({
      actorId: owner.id,
      projectId: project.id,
      userText: "把「调研现有方案」这个任务指派给 zhouyu，状态改成进行中",
    });

    console.log("\n======== 回复 ========\n" + r.text);
    console.log("\n======== 工具轨迹2 ========\n" + JSON.stringify(r.toolTrace, null, 2));
    console.log("\n======== 草案 ========\n" + JSON.stringify(r.drafts, null, 2));

    expect(r.drafts.length).toBeGreaterThan(0);
  }, 120000);
});
