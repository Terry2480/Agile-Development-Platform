import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcsEvents, icsDateToDateKey } from "../lib/ics.ts";

test("icsDateToDateKey：全天 / UTC / 本地时刻三种形态", () => {
  assert.equal(icsDateToDateKey("20261119"), "2026-11-19");
  // UTC 16:00 + 8h = 北京次日 00:00 → 归次日
  assert.equal(icsDateToDateKey("20261119T160000Z"), "2026-11-20");
  assert.equal(icsDateToDateKey("20261119T090000Z"), "2026-11-19");
  assert.equal(icsDateToDateKey("20261119T090000"), "2026-11-19");
  assert.equal(icsDateToDateKey("乱码"), null);
});

test("解析 Google 日历导出样例：折行 / 全天 / UTC / 换行转义", () => {
  const sample = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261123",
    "DTEND;VALUE=DATE:20261124",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "SUMMARY:每周例会",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261120T013000Z",
    "DTEND:20261120T023000Z",
    "SUMMARY:答辩彩排\\n带上演示数据",
    "DESCRIPTION:见议程",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;TZID=Asia/Shanghai:20261121T140000",
    "SUMMARY:小组讨论（这是一个非常长的标题，被导出工具按 RFC5545 折了",
    " 行，需要正确还原）",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:没有日期的事件",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { events, skipped } = parseIcsEvents(sample);
  assert.equal(events.length, 3);
  assert.equal(skipped, 1);
  assert.deepEqual(events[0], { title: "每周例会", dateKey: "2026-11-23" });
  assert.equal(events[1].title, "答辩彩排\n带上演示数据");
  assert.equal(events[1].dateKey, "2026-11-20"); // 01:30Z + 8h = 北京 09:30 当天
  assert.equal(events[2].dateKey, "2026-11-21");
  assert.ok(events[2].title.includes("折了行，需要正确还原"));
});

test("空输入与无 SUMMARY 事件", () => {
  assert.deepEqual(parseIcsEvents(""), { events: [], skipped: 0 });
  const { events } = parseIcsEvents("BEGIN:VEVENT\nDTSTART:20261125\nEND:VEVENT");
  assert.deepEqual(events, [{ title: "（无标题）", dateKey: "2026-11-25" }]);
});
