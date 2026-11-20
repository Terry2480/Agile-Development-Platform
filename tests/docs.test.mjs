import { test } from "node:test";
import assert from "node:assert/strict";
import { docExcerpt, pruneVersionIds, shouldSnapshotDoc } from "../lib/docs.ts";

test("snapshots happen only when title or content actually change", () => {
  const previous = { title: "纪要", content: "第一条" };
  assert.equal(shouldSnapshotDoc(previous, {}), false);
  assert.equal(shouldSnapshotDoc(previous, { title: "纪要", content: "第一条" }), false);
  assert.equal(shouldSnapshotDoc(previous, { title: "纪要 2" }), true);
  assert.equal(shouldSnapshotDoc(previous, { content: "第二条" }), true);
});

test("prune keeps the newest versions and deletes only the overflow", () => {
  const ids = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
  assert.deepEqual(pruneVersionIds(ids), [1, 2, 3, 4, 5]);
  assert.deepEqual(pruneVersionIds(ids.slice(0, 20)), []);
  assert.deepEqual(pruneVersionIds([]), []);
  assert.deepEqual(pruneVersionIds([{ id: 4 }, { id: 9 }], 1), [4]);
});

test("excerpt collapses whitespace for list display", () => {
  assert.equal(docExcerpt("  # 标题\n\n正文  内容  "), "# 标题 正文 内容");
  const long = "a".repeat(100);
  assert.equal(docExcerpt(long, 90), `${"a".repeat(90)}…`);
  assert.equal(docExcerpt(""), "");
});
