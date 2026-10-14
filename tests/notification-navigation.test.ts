import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type NotificationItem } from "../lib/api-client";
import { resolveNotificationTarget } from "../lib/notification-navigation";

const base: NotificationItem = { id: 1, type: "assigned", title: "任务通知", entityType: "task", entityId: 8, read: false, createdAt: "2026-10-14T01:00:00Z" };

test("assignment, comment, mention and deadline notifications resolve the task's actual project", async () => {
  const controller = new AbortController();
  for (const type of ["assigned", "comment", "mention", "deadline"] as const) {
    const target = await resolveNotificationTarget({ ...base, type }, controller.signal, async <T>(path: string, options?: { signal?: AbortSignal }) => {
      assert.equal(path, "/api/tasks/8");
      assert.equal(options?.signal, controller.signal);
      return { task: { id: 8, projectId: 12 } } as T;
    });
    assert.deepEqual(target, { projectId: 12, taskId: 8, section: "tasks" });
  }
});

test("project mentions enter chat, while legacy or invalid targets never make a request", async () => {
  assert.deepEqual(await resolveNotificationTarget({ ...base, entityType: "project", entityId: 4 }, undefined, async <T>(path: string) => {
    assert.equal(path, "/api/projects/4"); return { project: { id: 4 } } as T;
  }), { projectId: 4, section: "chat" });
  for (const item of [{ ...base, entityId: null }, { ...base, entityId: -1 }, { ...base, entityType: "unknown" }]) {
    assert.equal(await resolveNotificationTarget(item, undefined, async () => { throw new Error("must not fetch"); }), null);
  }
});

test("deleted and inaccessible targets have a useful message; connection and cancellation errors remain distinguishable", async () => {
  for (const status of [403, 404]) await assert.rejects(
    resolveNotificationTarget(base, undefined, async () => { throw new ApiError(status, "not accessible"); }),
    /已删除.*访问权限/,
  );
  const offline = new Error("无法连接服务器");
  await assert.rejects(resolveNotificationTarget(base, undefined, async () => { throw offline; }), (error) => error === offline);
  const aborted = new DOMException("Aborted", "AbortError");
  await assert.rejects(resolveNotificationTarget(base, undefined, async () => { throw aborted; }), (error) => error === aborted);
});
