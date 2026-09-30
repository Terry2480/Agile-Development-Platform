import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers";

// mock 飞书斥候：只验是否被调、收件人与卡片内容
const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendCardMessage: (...a: unknown[]) => sendMock(...a) }));

async function base() {
  const owner = await createUser({ email: "owner@e.com", password: "password123", name: "主帅" });
  const team = await createTeam(owner.id, "东吴");
  const project = await createProject(owner.id, team.id, { name: "赤壁" });
  return { owner, team, project };
}

describe("notifyTaskAssigned", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("负责人已绑飞书 → 发私信", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "斥候", assigneeId: owner.id, dueDate: "2026-08-01" });

    await new Promise((r) => setTimeout(r, 50)); // 让 createTask 的游离即时通知先跑完
    sendMock.mockClear();                         // 清掉 createTask 副作用产生的调用

    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
    expect(JSON.stringify(sendMock.mock.calls[0][1])).toContain("斥候"); // 卡片含任务标题
  });

  it("负责人未绑飞书 → 跳过", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id });
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("无负责人 → 跳过", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "x" });
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("飞书发送抛错 → 不抛出（fire-and-forget）", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id });
    sendMock.mockRejectedValueOnce(new Error("飞书挂了"));
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await expect(notifyTaskAssigned(task)).resolves.toBeUndefined();
  });
});

describe("notifyTaskCompleted", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("创建者≠操作者且已绑 → 通知创建者", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const doer = await createUser({ email: "doer@e.com", password: "password123", name: "小卒" });
    const task = await createTask(owner.id, project.id, { title: "攻城" });

    const { notifyTaskCompleted } = await import("@/lib/notify");
    await notifyTaskCompleted(task, doer.id);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
  });

  it("创建者=操作者 → 不发（免自我骚扰）", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "攻城" });
    const { notifyTaskCompleted } = await import("@/lib/notify");
    await notifyTaskCompleted(task, owner.id);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("scanAndNotifyDue", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("临期(明日)+逾期(昨日)按负责人聚合为一封", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    await createTask(owner.id, project.id, { title: "临期活", assigneeId: owner.id, dueDate: iso(tomorrow) });
    await createTask(owner.id, project.id, { title: "逾期活", assigneeId: owner.id, dueDate: iso(yesterday) });
    // done 的逾期任务不计
    const doneTask = await createTask(owner.id, project.id, { title: "已完成", assigneeId: owner.id, dueDate: iso(yesterday) });
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, doneTask.id));

    await new Promise((r) => setTimeout(r, 50)); // 让 createTask 的游离即时通知先跑完
    sendMock.mockClear();                         // 清掉 createTask 副作用产生的调用

    const { scanAndNotifyDue } = await import("@/lib/notify");
    const r = await scanAndNotifyDue();

    expect(sendMock).toHaveBeenCalledTimes(1); // 同一负责人一封
    const card = JSON.stringify(sendMock.mock.calls[0][1]);
    expect(card).toContain("临期活");
    expect(card).toContain("逾期活");
    expect(card).not.toContain("已完成");
    expect(r.notified).toBe(1);
  });

  it("未绑飞书的负责人 → 不发", async () => {
    const { owner, project } = await base();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id, dueDate: tomorrow.toISOString().slice(0, 10) });
    const { scanAndNotifyDue } = await import("@/lib/notify");
    const r = await scanAndNotifyDue();
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.notified).toBe(0);
  });
});
