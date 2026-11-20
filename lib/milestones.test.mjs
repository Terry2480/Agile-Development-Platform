import { test } from "node:test";
import assert from "node:assert/strict";
import { milestoneSchema, milestoneDays } from "./milestones.ts";

test("rejects impossible dates and missing names", () => {
  for (const dueOn of ["2026-02-30", "2026-13-01", "", "2026-1-1"]) {
    assert.equal(milestoneSchema.safeParse({ name: "开题", dueOn }).success, false);
  }
  assert.equal(milestoneSchema.safeParse({ name: "  ", dueOn: "2026-10-11" }).success, false);
});

test("deduplicates task links and leaves completion to manual confirmation", () => {
  const value = milestoneSchema.parse({ name: " 开题 ", dueOn: "2026-10-11", taskIds: [1, 1, 2] });
  assert.deepEqual(value.taskIds, [1, 2]);
  assert.equal(value.name, "开题");
  assert.equal(value.completed, false);
  assert.equal(milestoneSchema.safeParse({ ...value, taskIds: [-1] }).success, false);
});

test("counts calendar days using Hong Kong time at the midnight boundary", () => {
  assert.equal(milestoneDays("2026-10-11", new Date("2026-10-10T15:59:00Z")), 1);
  assert.equal(milestoneDays("2026-10-11", new Date("2026-10-10T16:00:00Z")), 0);
  assert.equal(milestoneDays("2026-10-10", new Date("2026-10-10T16:00:00Z")), -1);
});
