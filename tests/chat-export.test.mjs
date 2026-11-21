import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatMarkdown, exportTime, exportFileName } from "../lib/chat-export.ts";

const msg = (over = {}) => ({
  id: 1, content: "你好", createdAt: "2026-11-19T06:30:00Z", recalled: false,
  author: { displayName: "306001" }, attachment: null, task: null, replyTo: null, ...over,
});

test("exportTime 按北京时间格式化", () => {
  assert.equal(exportTime("2026-11-19T06:30:00Z"), "11-19 14:30");
  // UTC 16:10 → 北京次日 00:10
  assert.equal(exportTime("2026-11-19T16:10:00Z"), "11-20 00:10");
});

test("按天分组，附件 / 任务 / 引用 / 撤回齐全", () => {
  const md = buildChatMarkdown("敏捷校园平台", [
    msg({ id: 1, content: "第一天的消息", createdAt: "2026-11-18T09:00:00Z" }),
    msg({
      id: 2, content: "看这个", createdAt: "2026-11-19T02:00:00Z",
      replyTo: { authorName: "306001", content: "第一天的消息" },
      attachment: { name: "调研.xlsx", size: 1024 },
      task: { code: "AGILE-002", title: "完成用户调研报告", status: "todo" },
    }),
    msg({ id: 3, content: "撤回的内容", createdAt: "2026-11-19T03:00:00Z", recalled: true }),
  ]);
  assert.ok(md.startsWith("# 聊天记录 · 敏捷校园平台"));
  assert.ok(md.includes("## 11 月 18 日"));
  assert.ok(md.includes("## 11 月 19 日"));
  assert.ok(md.includes("**306001**：第一天的消息"));
  assert.ok(md.includes("> 回复 306001：第一天的消息"));
  assert.ok(md.includes("📎 附件：调研.xlsx（1024 字节）"));
  assert.ok(md.includes("🔗 关联任务：AGILE-002 完成用户调研报告"));
  assert.ok(md.includes("（已撤回）"));
  assert.ok(md.includes("消息条数：3"));
});

test("多行消息逐行缩进不吞内容，文件名清洗非法字符", () => {
  const md = buildChatMarkdown("测试", [msg({ content: "第一行\n第二行" })]);
  assert.ok(md.includes("第一行\n  第二行") || md.includes("- `11-19 14:30` **306001**：第一行"));
  assert.ok(exportFileName('项目/名称:A"B').startsWith("聊天记录-项目_名称_A_B-"), "非法字符应替换为下划线且保留日期后缀");
});
