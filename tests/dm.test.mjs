import { test } from "node:test";
import assert from "node:assert/strict";
import { countUnread, dmNotificationTitle, dmPair, dmPreview } from "../lib/dm.ts";

test("dmPair orders any direction into one canonical pair", () => {
  assert.deepEqual(dmPair(2, 7), [2, 7]);
  assert.deepEqual(dmPair(7, 2), [2, 7]);
});

test("dmPair rejects self-chat and non-integer ids", () => {
  assert.throws(() => dmPair(5, 5), /不能和自己私聊/);
  assert.throws(() => dmPair(1.5, 2), /整数/);
});

test("preview collapses whitespace and truncates with ellipsis", () => {
  assert.equal(dmPreview(null), "开始对话吧");
  assert.equal(dmPreview(""), "开始对话吧");
  assert.equal(dmPreview("  hello   world \n next "), "hello world next");
  const long = "字".repeat(70);
  assert.equal(dmPreview(long, 60), `${"字".repeat(60)}…`);
});

test("unread counts only partner messages without readAt", () => {
  const messages = [
    { senderId: 2, readAt: null },
    { senderId: 1, readAt: null },
    { senderId: 2, readAt: "2026-10-21T00:00:00Z" },
    { senderId: 2, readAt: null },
  ];
  assert.equal(countUnread(messages, 1), 2);
  assert.equal(countUnread(messages, 2), 1);
  assert.equal(countUnread([], 1), 0);
});

test("dm notification titles merge a batch of unread messages", () => {
  assert.equal(dmNotificationTitle("徐小龙", 1, []), "徐小龙 给你发来私信");
  assert.equal(dmNotificationTitle("徐小龙", 1, ["设计稿.fig"]), "徐小龙 给你发来文件《设计稿.fig》");
  assert.equal(dmNotificationTitle("徐小龙", 4, []), "徐小龙 给你发来私信（4 条未读）");
  assert.equal(
    dmNotificationTitle("徐小龙", 5, ["会议纪要.txt", "设计稿.png"]),
    "徐小龙 给你发来私信（5 条未读；文件：会议纪要.txt、设计稿.png）",
  );
  assert.equal(
    dmNotificationTitle("徐小龙", 9, ["1", "2", "3", "4", "5", "6", "7"]),
    "徐小龙 给你发来私信（9 条未读；文件：1、2、3、4、5 等 7 个文件）",
  );
});
