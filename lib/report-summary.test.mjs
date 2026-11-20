import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPreset, reportRangeSchema, renderReport } from "./report-summary.ts";

test("calendar presets use Hong Kong dates and handle month boundaries", () => {
  const now = new Date("2026-10-11T16:00:00Z");
  assert.deepEqual(reportPreset("week", now), { start: "2026-10-12", end: "2026-10-12" });
  assert.deepEqual(reportPreset("lastWeek", now), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(reportPreset("month", now), { start: "2026-10-01", end: "2026-10-12" });
});
test("rejects impossible and reversed date ranges", () => {
  assert.equal(reportRangeSchema.safeParse({ start: "2026-02-30", end: "2026-03-02" }).success, false);
  assert.equal(reportRangeSchema.safeParse({ start: "2026-10-12", end: "2026-10-11" }).success, false);
});
test("report output includes notes, assignees, milestones and empty states", () => {
  const text = renderReport({ projectName: "课程项目", start: "2026-10-05", end: "2026-10-11", generatedAt: "2026-10-11", completed: [{ id: 1, code: "WEB-001", title: "原型", status: "done", assignee: "小王", dueOn: null }], doing: [], overdue: [], milestones: [{ id: 1, name: "中期检查", dueOn: "2026-10-15", completed: false, done: 1, total: 2 }] }, "接口受阻", "准备汇报");
  for (const content of ["小王", "WEB-001", "1/2", "接口受阻", "准备汇报", "暂无"]) assert.ok(text.includes(content));
});
