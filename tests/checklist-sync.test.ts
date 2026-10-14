import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChecklistChange, type ChecklistItem, type ChecklistChange } from "../lib/task-checklist";

test("changes from another panel survive an older in-flight load without duplicating steps", () => {
  const original: ChecklistItem = { id: 1, taskId: 5, title: "准备汇报", completed: false };
  const added: ChecklistItem = { id: 2, taskId: 5, title: "制作 PPT", completed: false };
  const changes: ChecklistChange[] = [
    { taskId: 5, type: "upsert", item: { ...original, completed: true } },
    { taskId: 5, type: "upsert", item: added },
    { taskId: 5, type: "upsert", item: { ...added, title: "完成 PPT" } },
    { taskId: 5, type: "delete", itemId: original.id },
  ];
  assert.deepEqual(changes.reduce(applyChecklistChange, [original]), [{ ...added, title: "完成 PPT" }]);
  assert.deepEqual(changes.reduce(applyChecklistChange, [original, added]), [{ ...added, title: "完成 PPT" }]);
});
