import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestGate } from "../lib/request-gate";
import { api, uploadFile, ApiError } from "../lib/api-client";

test("late results from A → B → A cannot commit, even when fetch ignores abort", async () => {
  const gate = new RequestGate();
  let resolveOld!: (value: string) => void;
  const old = gate.begin("tasks");
  const output: string[] = [];
  const pending = new Promise<string>((resolve) => { resolveOld = resolve; }).then((value) => {
    if (old.current()) output.push(value);
  });
  gate.cancel(["tasks"]);
  const second = gate.begin("tasks");
  gate.cancel(["tasks"]);
  const newest = gate.begin("tasks");
  resolveOld("old A");
  await pending;
  if (newest.current()) output.push("new A");
  assert.deepEqual(output, ["new A"]);
  assert.equal(second.current(), false);
  assert.equal(old.signal.aborted, true);
});

test("overlapping refreshes accept only newest request and leave other resources alone", () => {
  const gate = new RequestGate();
  const chat = gate.begin("chat");
  const first = gate.begin("files");
  const second = gate.begin("files");
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  assert.equal(chat.current(), true);
  gate.cancel();
  assert.equal(chat.current(), false);
  assert.equal(second.current(), false);
});

test("network, invalid JSON, permissions and upload failures provide readable errors", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(api("/test"), /无法连接服务器/);
  await assert.rejects(uploadFile("/test", new File(["test"], "test.txt")), /无法连接服务器/);
  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(api("/test"), (e: unknown) => e instanceof ApiError && e.status === 502 && e.message.includes("服务器"));
  globalThis.fetch = async () => new Response("invalid", { status: 200 });
  await assert.rejects(api("/test"), /数据异常/);
  globalThis.fetch = async () => Response.json({ error: "无权上传文件" }, { status: 403 });
  await assert.rejects(uploadFile("/test", new File(["test"], "test.txt")), /无权上传文件/);
});
