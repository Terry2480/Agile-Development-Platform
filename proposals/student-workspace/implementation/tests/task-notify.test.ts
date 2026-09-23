import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { resetDb } from "./helpers";

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendCardMessage: (...a: unknown[]) => sendMock(...a) }));

// fire-and-forget 的通知内部有一次真实 DB 查询（openIdOf），耗时超过单个 setTimeout(0) 宏任务；
// 轮询等待，给游离 promise 足够时间落地，同时不拖慢测试。
async function waitForCall(maxMs = 500) {
  const start = Date.now();
  while (sendMock.mock.calls.length === 0 && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function base() {
  const owner = await createUser({ email: "o@e.com", password: "password123", name: "主帅" });
  const team = await createTeam(owner.id, "东吴");
  const project = await createProject(owner.id, team.id, { name: "赤壁" });
  await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
  return { owner, team, project };
}

describe("即时通知接入", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("建任务带负责人 → 发被指派通知", async () => {
    const { owner, project } = await base();
    await createTask(owner.id, project.id, { title: "斥候", assigneeId: owner.id });
    await waitForCall();
    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
  });

  it("改派 → 发被指派通知给新负责人", async () => {
    const { owner, team, project } = await base();
    const other = await createUser({ email: "x@e.com", password: "password123", name: "副将" });
    await joinTeam(other.id, team.inviteCode);
    await bindFeishu(other.id, { openId: "ou_other", name: "副将" });
    const task = await createTask(owner.id, project.id, { title: "布阵" });
    sendMock.mockClear();

    await updateTask(owner.id, task.id, { assigneeId: other.id });
    await waitForCall();
    expect(sendMock.mock.calls.some((c) => c[0] === "ou_other")).toBe(true);
  });

  it("owner 自建自完成 → 不发完成通知（创建者=操作者）", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "攻城" });
    sendMock.mockClear();

    await updateTask(owner.id, task.id, { status: "done", completionNote: "克" });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMock).not.toHaveBeenCalled();
  });
});
