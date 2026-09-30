import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { POST as cronRoute } from "@/app/api/cron/reminders/route";
import { resetDb } from "./helpers";

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendCardMessage: (...a: unknown[]) => sendMock(...a) }));

function req(secret?: string) {
  return new Request("http://test/api/cron/reminders", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST /api/cron/reminders", () => {
  beforeEach(async () => {
    await resetDb();
    sendMock.mockClear();
    vi.stubEnv("CRON_SECRET", "cron-xyz");
  });

  it("缺 secret → 401", async () => {
    const res = await cronRoute(req());
    expect(res.status).toBe(401);
  });

  it("错 secret → 401", async () => {
    const res = await cronRoute(req("wrong"));
    expect(res.status).toBe(401);
  });

  it("对 secret → 扫描并发提醒", async () => {
    const owner = await createUser({ email: "o@e.com", password: "password123", name: "主帅" });
    const team = await createTeam(owner.id, "东吴");
    const project = await createProject(owner.id, team.id, { name: "赤壁" });
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await createTask(owner.id, project.id, { title: "临期活", assigneeId: owner.id, dueDate: tomorrow.toISOString().slice(0, 10) });
    // 建任务时会触发一次「新任务指派」通知（fire-and-forget），与本测试要验证的
    // cron 扫描通知无关，等其落定后清空计数，避免污染下面的断言。
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalled());
    sendMock.mockClear();

    const res = await cronRoute(req("cron-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
