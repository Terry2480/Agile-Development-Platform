import { test } from "node:test";
import assert from "node:assert/strict";
import { startPolling } from "../lib/polling";
import { RequestGate } from "../lib/request-gate";

function clock() {
  let next: (() => void) | undefined;
  const delays: number[] = [];
  const scheduler = {
    set(callback: () => void, delay: number) { next = callback; delays.push(delay); return 1 as unknown as ReturnType<typeof setTimeout>; },
    clear() { next = undefined; },
  };
  return { scheduler, delays, fire() { const callback = next; next = undefined; callback?.(); }, pending: () => !!next };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("slow requests never overlap and a stopped poll never restarts", async () => {
  const fake = clock(); let calls = 0; let release!: () => void;
  const stop = startPolling(async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); }, 8000, fake.scheduler);
  fake.fire(); fake.fire();
  assert.equal(calls, 1); assert.equal(fake.pending(), false);
  stop(); release(); await flush();
  assert.equal(fake.pending(), false);
});

test("failures back off and success restores normal interval", async () => {
  const fake = clock(); let fail = true;
  const stop = startPolling(async () => { if (fail) throw new Error("network"); }, 8000, fake.scheduler);
  for (let i = 0; i < 4; i++) { fake.fire(); await flush(); }
  assert.deepEqual(fake.delays, [8000, 16000, 32000, 64000, 64000]);
  fail = false; fake.fire(); await flush();
  assert.equal(fake.delays.at(-1), 8000); stop();
});

test("background poll skips active initial/manual fetch without aborting it", async () => {
  const gate = new RequestGate(); const initial = gate.begin("chat");
  const fake = clock(); let calls = 0;
  const stop = startPolling(async () => { if (!gate.isPending("chat")) calls++; }, 8000, fake.scheduler);
  fake.fire(); await flush();
  assert.equal(calls, 0); assert.equal(initial.signal.aborted, false);
  initial.finish(); fake.fire(); await flush();
  assert.equal(calls, 1); stop();
});
