import { test } from "node:test";
import assert from "node:assert/strict";
import { teachingWeekDate, milestoneSchema } from "../lib/milestones";

test("week starts Monday, including midweek semester starts and year boundaries", () => {
  assert.equal(teachingWeekDate("2026-09-02", 1, 1), "2026-08-31");
  assert.equal(teachingWeekDate("2026-09-02", 1), "2026-09-06");
  assert.equal(teachingWeekDate("2026-09-02", 8, 5), "2026-10-23");
  assert.equal(teachingWeekDate("2026-12-28", 2, 1), "2027-01-04");
  assert.equal(teachingWeekDate("2024-02-26", 1, 4), "2024-02-29");
});
test("invalid dates and week values are rejected", () => {
  for (const [date, week, weekday] of [["2026-02-30", 1, 1], ["2026-09-01", 0, 1], ["2026-09-01", 53, 1], ["2026-09-01", 1, 8]] as const) assert.equal(teachingWeekDate(date, week, weekday), "");
  assert.equal(milestoneSchema.safeParse({ name: "汇报", teachingWeek: 8 }).success, false);
});
test("server recomputes dates and date mode clears teaching week metadata", () => {
  const result = milestoneSchema.parse({ name: "汇报", dueOn: "2020-01-01", semesterStartsOn: "2026-09-02", teachingWeek: 8, teachingWeekday: 5 });
  assert.equal(result.dueOn, "2026-10-23");
  const fixed = milestoneSchema.parse({ name: "汇报", dueOn: "2026-10-23", semesterStartsOn: "2026-09-02", teachingWeek: null });
  assert.equal(fixed.semesterStartsOn, null);
  assert.equal(fixed.teachingWeekday, null);
});
