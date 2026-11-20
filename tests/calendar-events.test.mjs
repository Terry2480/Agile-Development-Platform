import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysInMonth, monthDays, groupEventsByDate,
  prevMonth, nextMonth, monthRange,
  assertDateKey, assertMonthKey,
} from "../lib/calendar-events.ts";

test("daysInMonth 处理平年闰年", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 11), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("monthDays 固定 42 格、周一起始、跨月补位", () => {
  const cells = monthDays(2026, 11); // 2026-11-01 是周日 → 周一起始补 6 天
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, "2026-10-26");
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells.find((c) => c.key === "2026-11-01").inMonth, true);
  assert.equal(cells.at(-1).key, "2026-12-06");
  // 2026-11-02 是周一，应为第二行第一天
  assert.equal(cells[7].key, "2026-11-02");
});

test("groupEventsByDate 保持传入顺序并按日期归组", () => {
  const map = groupEventsByDate([
    { date: "2026-11-20", kind: "task", title: "b", projectId: 1, projectName: "P" },
    { date: "2026-11-19", kind: "milestone", title: "a", projectId: 1, projectName: "P" },
    { date: "2026-11-20", kind: "task", title: "c", projectId: 1, projectName: "P" },
  ]);
  assert.deepEqual(Object.keys(map), ["2026-11-20", "2026-11-19"]);
  assert.equal(map["2026-11-20"].length, 2);
  assert.equal(map["2026-11-19"][0].kind, "milestone");
});

test("月份导航与区间", () => {
  assert.equal(prevMonth("2026-11"), "2026-10");
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-11"), "2026-12");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
});

test("非法日期/月份被拒绝", () => {
  assert.throws(() => assertDateKey("2026-11-1"), /YYYY-MM-DD/);
  assert.throws(() => assertDateKey("20261119"), /YYYY-MM-DD/);
  assert.throws(() => assertMonthKey("2026-13"), /YYYY-MM/);
  assert.throws(() => assertMonthKey("2026-1"), /YYYY-MM/);
  assert.equal(assertMonthKey("2026-11"), "2026-11");
});
