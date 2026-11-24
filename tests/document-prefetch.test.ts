import { test } from "node:test";
import assert from "node:assert/strict";
import { clearCached, entryCount, peekCached, peekPrefetch, putCached, resetPrefetch, startPrefetch } from "../components/ws/documents/prefetch";

test("预取完成后，有效期内可以直接命中同一份数据", async () => {
  resetPrefetch({ ttlMs: 20_000 });
  const entry = startPrefetch("open:1", async () => ({ space: { id: 7 } }));
  await entry.promise;
  const hit = peekPrefetch<{ space: { id: number } }>("open:1", 10_000);
  assert.equal(hit?.data.space.id, 7);
  assert.ok(hit.age >= 0);
});

test("同一个键在有效期内不会重复发起请求", async () => {
  resetPrefetch();
  let calls = 0;
  const request = async () => { calls += 1; return { ok: true }; };
  startPrefetch("k", request);
  startPrefetch("k", request);
  startPrefetch("k", request);
  assert.equal(calls, 1);
});

test("超过有效期不再命中，且读取本身不清理缓存", async () => {
  resetPrefetch({ ttlMs: 20_000 });
  let calls = 0;
  const request = async () => { calls += 1; return calls; };
  const first = startPrefetch("k", request, 1_000);
  await first.promise;
  assert.equal(peekPrefetch("k", 10_000, 1_000)?.data, 1);
  assert.equal(peekPrefetch("k", 10_000, 30_000), null);
  // peek 是只读的：过期条目仍在，由写入时按容量/过期自然淘汰
  assert.equal(entryCount(), 1);
  // 过期后可以重新预取，拿到新数据
  const second = startPrefetch("k", request, 30_000);
  await second.promise;
  assert.equal(calls, 2);
  assert.equal(peekPrefetch("k", 10_000, 30_500)?.data, 2);
});

test("预取失败不会留下脏数据，也不会抛出未处理的 rejection", async () => {
  resetPrefetch();
  const entry = startPrefetch("bad", async () => { throw new Error("网络失败"); });
  await entry.promise.catch(() => {});
  await Promise.resolve();
  assert.equal(peekPrefetch("bad", 10_000), null);
  assert.equal(entryCount(), 0);
});

test("缓存条目数超过上限时淘汰最早的", async () => {
  resetPrefetch({ max: 2, ttlMs: 60_000 });
  for (const [index, key] of ["a", "b", "c"].entries()) {
    const entry = startPrefetch(key, async () => index, 1_000 + index);
    await entry.promise;
  }
  assert.equal(entryCount(), 2);
  assert.equal(peekPrefetch("a", 60_000, 1_000), null);
  assert.equal(peekPrefetch("b", 60_000, 1_000)?.data, 1);
  assert.equal(peekPrefetch("c", 60_000, 1_000)?.data, 2);
});

test("目录树可以直接写入缓存，并按前缀整体作废", () => {
  resetPrefetch({ ttlMs: 60_000 });
  putCached("tree:1:9:/api/nodes?parentId=null|0", { nodes: [1, 2] }, 1_000);
  putCached("tree:1:9:/api/nodes?parentId=5|0", { nodes: [3] }, 1_000);
  putCached("tree:2:9:/api/nodes?parentId=null|0", { nodes: [9] }, 1_000);
  assert.equal(peekCached<{ nodes: number[] }>("tree:1:9:/api/nodes?parentId=null|0", 30_000, 1_000)?.data.nodes.length, 2);

  clearCached("tree:1:9");
  assert.equal(peekCached("tree:1:9:/api/nodes?parentId=null|0", 30_000, 1_000), null);
  assert.equal(peekCached("tree:1:9:/api/nodes?parentId=5|0", 30_000, 1_000), null);
  // 其它账号/空间的缓存不受影响
  assert.equal(peekCached<{ nodes: number[] }>("tree:2:9:/api/nodes?parentId=null|0", 30_000, 1_000)?.data.nodes[0], 9);
});

test("前缀匹配按段边界走，不会误伤编号相邻的空间", () => {
  resetPrefetch({ ttlMs: 60_000 });
  putCached("list:1:9:/a", { nodes: [9] }, 1_000);
  putCached("list:1:90:/a", { nodes: [90] }, 1_000);
  clearCached("list:1:9");
  assert.equal(peekCached("list:1:9:/a", 30_000, 1_000), null);
  assert.equal(peekCached<{ nodes: number[] }>("list:1:90:/a", 30_000, 1_000)?.data.nodes[0], 90);
});
