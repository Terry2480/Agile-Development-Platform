import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskAction } from "../lib/task-action";

test("rapid submissions are locked throughout both write and refresh", async () => {
  const action = new TaskAction();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const pending = action.run(async () => { writes++; }, () => waiting);
  assert.equal(await action.run(async () => { writes++; }, async () => {}), "busy");
  release();
  assert.equal(await pending, "saved");
  assert.equal(writes, 1);
});

test("refresh failure reports saved and never repeats the write", async () => {
  const action = new TaskAction();
  let writes = 0;
  assert.equal(await action.run(async () => { writes++; }, async () => { throw new Error("network"); }), "refresh-failed");
  assert.equal(writes, 1);
  assert.equal(await action.run(async () => {}, async () => {}), "saved");
});

test("write failure preserves error, skips refresh and releases lock", async () => {
  const action = new TaskAction();
  let refreshes = 0;
  await assert.rejects(action.run(async () => { throw new Error("denied"); }, async () => { refreshes++; }), /denied/);
  assert.equal(refreshes, 0);
  assert.equal(await action.run(async () => {}, async () => {}), "saved");
});
