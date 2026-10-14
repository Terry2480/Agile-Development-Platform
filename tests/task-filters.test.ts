import { test } from "node:test";
import assert from "node:assert/strict";
import type { TaskItem } from "../lib/api-client";
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from "../lib/task-filters";

const task = (id: number, patch: Partial<TaskItem>): TaskItem => ({
  id, projectId: 10, projectName: "课程项目", sprintId: 100, number: id, code: `WEB-${id}`, title: "准备汇报",
  description: null, status: "todo", priority: "high", assigneeId: 2, assignee: null, collaborators: [{ id: 2, displayName: "负责人" }],
  dueOn: "2026-10-14", labels: [{ id: 7, name: "汇报", color: "#fff" }], commentCount: 0, attachmentCount: 0, createdAt: "", updatedAt: "", ...patch,
});
const data = [task(1, {}), task(2, { assigneeId: 3, collaborators: [{ id: 2, displayName: "协作" }], dueOn: "2026-10-13" }),
  task(3, { dueOn: "2026-10-15", status: "done" }), task(4, { assigneeId: null, collaborators: [], dueOn: null, sprintId: null }),
  task(5, { projectId: 11, priority: "low", dueOn: "2026-10-15", sprintId: 200, labels: [] })];
const run = (patch: Partial<TaskFilters>, search = "") => filterTasks(data, { ...EMPTY_TASK_FILTERS, ...patch }, 2, search, [100], new Date("2026-10-13T16:30:00Z")).map((task) => task.id);

test("responsible and collaborating roles are distinct, while mine includes both", () => {
  assert.deepEqual(run({ relation: "assigned" }), [1, 3, 5]);
  assert.deepEqual(run({ relation: "collaborating" }), [2]);
  assert.deepEqual(run({ relation: "mine" }), [1, 2, 3, 5]);
});
test("deadline filters use UTC+8 at the date boundary and exclude completed tasks", () => {
  assert.deepEqual(run({ due: "today" }), [1]);
  assert.deepEqual(run({ due: "overdue" }), [2]);
  assert.deepEqual(run({ due: "tomorrow" }), [5]);
  assert.deepEqual(run({ due: "none" }), [4]);
});
test("unassigned filtering is different from all, and combined criteria respect current iterations and search", () => {
  assert.deepEqual(run({ assignee: "unassigned" }), [4]);
  assert.deepEqual(run({ activeSprint: true, relation: "mine", label: "7", status: "todo", priority: "high", project: "10" }), [1, 2]);
  assert.deepEqual(run({}, "web-2"), [2]);
  assert.deepEqual(run({}, "课程项目"), [1, 2, 3, 4, 5]);
  assert.deepEqual(run({ project: "11", due: "today" }), []);
  assert.deepEqual(run({}), [1, 2, 3, 4, 5]);
});
