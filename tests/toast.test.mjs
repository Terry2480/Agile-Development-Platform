import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeToast, toast } from "../lib/toast.ts";

test("toast bus delivers events to subscribers and unsubscribe stops delivery", () => {
  const received = [];
  const received2 = [];
  const off = subscribeToast((item) => received.push(`${item.kind}:${item.text}`));
  const off2 = subscribeToast((item) => received2.push(item.text));

  toast("已收藏项目");
  toast("保存失败", "error");
  off2();

  toast("会话已删除");

  assert.deepEqual(received, ["ok:已收藏项目", "error:保存失败", "ok:会话已删除"]);
  assert.deepEqual(received2, ["已收藏项目", "保存失败"]);
  off();
  toast("无人接收");
  assert.equal(received.length, 3);
});

test("toast events carry unique ids", () => {
  const ids = [];
  const off = subscribeToast((item) => ids.push(item.id));
  for (let i = 0; i < 50; i++) toast(`msg-${i}`);
  off();
  assert.equal(new Set(ids).size, 50);
});
