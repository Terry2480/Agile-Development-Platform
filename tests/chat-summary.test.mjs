import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeChat } from "../lib/chat-summary.ts";

test("summarizeChat aggregates participants, tasks, files, links and open questions", () => {
  const s = summarizeChat([
    { authorName: "徐小龙", content: "SPRINT 冲刺开始，E2E-002 今天必须完成", attachmentName: null },
    { authorName: "陈后端", content: "接口文档 https://example.com/api 已更新，E2E-003 呢？", attachmentName: null },
    { authorName: "陈后端", content: "附上联调记录", attachmentName: "联调记录.txt" },
    { authorName: "林设计", content: "收到？", attachmentName: null },
    { authorName: "徐小龙", content: "再看下 WEB-012 和 e2e-002（小写不算）", attachmentName: null },
  ]);
  assert.equal(s.messageCount, 5);
  assert.deepEqual(s.participants, ["徐小龙", "陈后端", "林设计"]);
  assert.deepEqual(s.tasks, ["E2E-002", "E2E-003", "WEB-012"]);
  assert.deepEqual(s.files, ["联调记录.txt"]);
  assert.deepEqual(s.links, ["https://example.com/api"]);
  assert.equal(s.openQuestions, 2);
});

test("summarizeChat dedupes repeated task codes and links and handles empty input", () => {
  const s = summarizeChat([
    { authorName: "A", content: "E2E-001 与 E2E-001 重复，链接 https://a.com 和 https://a.com 也重复", attachmentName: null },
  ]);
  assert.deepEqual(s.tasks, ["E2E-001"]);
  assert.deepEqual(s.links, ["https://a.com"]);
  assert.equal(s.openQuestions, 0);
  const empty = summarizeChat([]);
  assert.equal(empty.messageCount, 0);
  assert.deepEqual(empty.participants, []);
});
