import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateResetCode, hashCode, isResetCodeValid, isPasswordValid,
  RESET_CODE_LENGTH, RESET_MAX_ATTEMPTS,
} from "../lib/password-reset.ts";

test("generateResetCode 生成 6 位数字验证码", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateResetCode();
    assert.equal(code.length, RESET_CODE_LENGTH);
    assert.match(code, /^\d{6}$/);
  }
});

test("hashCode 稳定且不同验证码摘要不同", () => {
  assert.equal(hashCode("123456"), hashCode("123456"));
  assert.notEqual(hashCode("123456"), hashCode("654321"));
});

test("isResetCodeValid 校验通过条件", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const ok = isResetCodeValid({
    usedAt: null,
    expiresAt: new Date("2026-11-19T12:10:00Z"),
    attempts: 0,
    codeHash: hashCode("123456"),
    inputHash: hashCode("123456"),
    now,
  });
  assert.deepEqual(ok, { ok: true });
});

test("isResetCodeValid 拦截已使用 / 过期 / 超次数 / 验证码错误", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const base = {
    usedAt: null,
    expiresAt: new Date("2026-11-19T12:10:00Z"),
    attempts: 0,
    codeHash: hashCode("123456"),
    inputHash: hashCode("123456"),
    now,
  };
  assert.equal(isResetCodeValid({ ...base, usedAt: new Date("2026-11-19T11:59:00Z") }).reason, "used");
  assert.equal(isResetCodeValid({ ...base, expiresAt: new Date("2026-11-19T11:59:59Z") }).reason, "expired");
  assert.equal(isResetCodeValid({ ...base, attempts: RESET_MAX_ATTEMPTS }).reason, "attempts");
  assert.equal(isResetCodeValid({ ...base, inputHash: hashCode("999999") }).reason, "mismatch");
});

test("isPasswordValid 与注册策略一致（6-128 位）", () => {
  assert.equal(isPasswordValid("12345"), false);
  assert.equal(isPasswordValid("123456"), true);
  assert.equal(isPasswordValid("a".repeat(128)), true);
  assert.equal(isPasswordValid("a".repeat(129)), false);
});
