import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDocSummary, formatDocSummary } from "../lib/doc-summary.ts";

const doc = [
  "# 用户调研报告",
  "",
  "这是开篇第一段，交代调研背景与目标。",
  "",
  "## 调研方法",
  "- 问卷调查 **20 份**",
  "- 深度访谈 5 人",
  "",
  "> 参考 [[AGILE-002]] 与 [[AGILE-003]] 的排期",
  "",
  "外部资料见 https://example.com/report 和 https://example.com/data",
].join("\n");

test("提取标题结构 / 要点 / 任务引用 / 链接", () => {
  const s = extractDocSummary(doc);
  assert.ok(s.headings.includes("用户调研报告"));
  assert.ok(s.headings.includes("调研方法"));
  assert.ok(s.keyPoints.some((p) => p.includes("开篇第一段")), "首段进入要点");
  assert.ok(s.keyPoints.some((p) => p.includes("问卷调查 20 份")), "列表项进入要点且去标记");
  assert.deepEqual(s.taskRefs, ["AGILE-002", "AGILE-003"]);
  assert.equal(s.links.length, 2);
});

test("阅读时长与格式化输出", () => {
  const s = extractDocSummary(doc);
  assert.ok(s.readingMinutes >= 1);
  const lines = formatDocSummary(s);
  assert.ok(lines[0].includes("预计阅读"));
  assert.ok(lines.some((l) => l.startsWith("结构：")));
  assert.ok(lines.some((l) => l.includes("关联任务：AGILE-002、AGILE-003")));
  assert.ok(lines.some((l) => l.includes("外部链接 2 个")));
});

test("空文档与要点上限（8 条）", () => {
  const empty = extractDocSummary("");
  assert.equal(empty.keyPoints.length, 0);
  assert.equal(empty.readingMinutes, 1);
  const many = extractDocSummary(Array.from({ length: 20 }, (_, i) => `- 条目${i + 1}`).join("\n"));
  assert.equal(many.keyPoints.length, 8);
});
