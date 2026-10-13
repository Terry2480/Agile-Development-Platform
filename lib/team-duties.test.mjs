import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageDuties, dutySchema, dutiesSchema, LEADER_DUTY, memberDuty, memberDuties } from "./team-duties.ts";

test("existing team owners default to leaders without a stored duty", () => {
  assert.equal(memberDuty({ role: "owner", duty: null }), LEADER_DUTY);
  assert.equal(canManageDuties({ role: "owner", duty: null }), true);
});

test("multiple duties preserve legacy values and check leadership anywhere in the list", () => {
  assert.deepEqual(memberDuties({ role: "member", duty: "开发者" }), ["开发者"]);
  assert.deepEqual(memberDuties({ role: "member", duty: LEADER_DUTY, duties: [] }), []);
  assert.equal(canManageDuties({ role: "member", duty: null, duties: ["开发者", LEADER_DUTY] }), true);
  assert.deepEqual(memberDuties({ role: "owner", duty: null, duties: ["开发者", "展示人"] }), [LEADER_DUTY, "开发者", "展示人"]);
  assert.deepEqual(dutiesSchema.parse({ duties: [" 开发者 ", "开发者", "文档"] }), { duties: ["开发者", "文档"] });
  assert.deepEqual(dutiesSchema.parse({ duties: [] }), { duties: [] });
  for (const body of [{}, { duties: null }, { duties: [" "] }, { duties: ["字".repeat(31)] }, { duties: Array(11).fill("测试") }]) {
    assert.equal(dutiesSchema.safeParse(body).success, false);
  }
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
