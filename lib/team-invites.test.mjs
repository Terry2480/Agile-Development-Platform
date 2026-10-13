import { test } from "node:test";
import assert from "node:assert/strict";
import { joinCodeSchema, canManageInvites } from "./team-invites.ts";
test("normalizes codes and rejects malformed input", () => {
  assert.equal(joinCodeSchema.parse({ code: " abcdef1234567890 " }).code, "ABCDEF1234567890");
  for (const code of ["", "1234", "G".repeat(16), "A".repeat(17)]) assert.equal(joinCodeSchema.safeParse({ code }).success, false);
});
test("only owners, administrators and designated leaders manage invitations", () => {
  assert.equal(canManageInvites({ role: "owner", duty: null }), true);
  assert.equal(canManageInvites({ role: "admin", duty: null }), true);
  assert.equal(canManageInvites({ role: "member", duty: "负责人（组长）" }), true);
  assert.equal(canManageInvites({ role: "member", duty: "开发者", duties: ["开发者", "负责人（组长）"] }), true);
  assert.equal(canManageInvites({ role: "member", duty: "负责人（组长）", duties: [] }), false);
  for (const duty of [null, "展示人", "开发者", "测试"]) assert.equal(canManageInvites({ role: "member", duty }), false);
});
