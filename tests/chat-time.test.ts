import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtTime, fmtDateShort, dayKey } from "../lib/api-client";

test("chat dates and times share UTC+8 boundaries", () => {
  assert.equal(fmtTime("2026-10-13T09:26:00Z"), "17:26");
  assert.equal(dayKey("2026-10-13T09:26:00Z"), "2026-10-13");
  assert.equal(dayKey("2026-10-13T16:00:00Z"), "2026-10-14");
  assert.equal(fmtTime("2026-10-13T16:00:00Z"), "00:00");
  assert.equal(fmtDateShort("2026-10-13T09:26:00Z"), "10月13日");
  assert.equal(fmtTime("2026-10-13T17:26:00+08:00"), "17:26");
});
