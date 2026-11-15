import { test } from "node:test";
import assert from "node:assert/strict";
import { docExcerpt, groupDocsByFolder, pruneVersionIds, shouldSnapshotDoc } from "../lib/docs.ts";

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

test("folder grouping merges non-adjacent same-folder docs (no duplicate groups/keys)", () => {
  // 接口按更新时间倒序返回：会议纪要的两篇被接口文档隔开
  const docs = [
    { id: 1, folder: "会议纪要" },
    { id: 2, folder: "接口文档" },
    { id: 3, folder: "会议纪要" },
    { id: 4, folder: null },
  ];
  const groups = groupDocsByFolder(docs);
  assert.deepEqual(groups.map(([name]) => name), ["会议纪要", "接口文档", "未分组"]);
  assert.deepEqual(groups[0][1].map((d) => d.id), [1, 3]); // 组内保持传入顺序
  assert.deepEqual(groups[2][1].map((d) => d.id), [4]);
  // 分组名唯一（React key 不再重复）
  assert.equal(new Set(groups.map(([name]) => name)).size, groups.length);
});

test("folder grouping sorts names, keeps ungrouped last, handles empty input", () => {
  const groups = groupDocsByFolder([
    { folder: null }, { folder: "B组" }, { folder: "A组" }, { folder: "B组" },
  ]);
  assert.deepEqual(groups.map(([name]) => name), ["A组", "B组", "未分组"]);
  assert.deepEqual(groupDocsByFolder([]), []);
});
