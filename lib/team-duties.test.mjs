import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageDuties, dutySchema, LEADER_DUTY, memberDuty } from "./team-duties.ts";

test("existing team owners default to leaders without a stored duty", () => {
  assert.equal(memberDuty({ role: "owner", duty: null }), LEADER_DUTY);
  assert.equal(canManageDuties({ role: "owner", duty: null }), true);
});

test("only leaders manage duties; system administrators and custom duties do not grant access", () => {
  assert.equal(canManageDuties({ role: "member", duty: LEADER_DUTY }), true);
  for (const role of ["admin", "member"]) {
    for (const duty of [null, "展示人", "开发者", "测试", "负责人"]) {
      assert.equal(canManageDuties({ role, duty }), false);
    }
  }
});

test("duty input supports custom labels and clearing, trims whitespace and rejects invalid input", () => {
  assert.deepEqual(dutySchema.parse({ duty: "  文档整理  " }), { duty: "文档整理" });
  assert.deepEqual(dutySchema.parse({ duty: null }), { duty: null });
  for (const body of [{}, { duty: "   " }, { duty: "字".repeat(31) }, { duty: 123 }]) {
    assert.equal(dutySchema.safeParse(body).success, false);
  }
});
