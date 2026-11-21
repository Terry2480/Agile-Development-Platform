import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, icsFileName } from "../lib/ics-export.ts";

test("标准结构：VCALENDAR 头 / 全天事件 / CATEGORIES / 结尾", () => {
  const ics = buildIcs([
    { dateKey: "2026-11-20", title: "AGILE-002 完成用户调研报告", kind: "task" },
    { dateKey: "2026-11-25", title: "需求评审里程碑", kind: "milestone" },
  ], "敏捷校园 · 11 月");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0"));
  assert.ok(ics.includes("X-WR-CALNAME:敏捷校园 · 11 月"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261120"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261121"), "全天事件 DTEND 为次日");
  assert.ok(ics.includes("SUMMARY:AGILE-002 完成用户调研报告"));
  assert.ok(ics.includes("CATEGORIES:任务截止"));
  assert.ok(ics.includes("CATEGORIES:里程碑"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  // 按日期升序
  assert.ok(ics.indexOf("20261120") < ics.indexOf("20261125"));
});

test("RFC5545 转义：逗号 / 分号 / 换行 / 反斜杠", () => {
  const ics = buildIcs([{ dateKey: "2026-11-20", title: "带,分号;与\\反斜杠", kind: "personal" }], "T");
  assert.ok(ics.includes("SUMMARY:带\\,分号\\;与\\\\反斜杠"));
});

test("文件名清洗非法字符", () => {
  assert.equal(icsFileName('11月/日历:*?"<>|'), "11月_日历_______.ics");
  assert.equal(icsFileName("  "), "日历.ics");
});
