import { createHash } from "node:crypto";

// 找回密码的纯逻辑：验证码生成 / 摘要 / 有效期与尝试次数校验。
// 抽成纯函数便于单元测试；数据库读写与会话处理留给 API 路由。
export const RESET_CODE_TTL_MINUTES = 10;   // 验证码 10 分钟有效
export const RESET_MAX_ATTEMPTS = 5;         // 最多猜 5 次
export const RESET_CODE_LENGTH = 6;          // 6 位数字验证码

// 生成 6 位数字验证码（补零，避免首位为 0 时长度不足）
export function generateResetCode(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(RESET_CODE_LENGTH, "0");
}

// 验证码摘要：数据库只存 sha256，不存明文
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// 校验验证码是否有效：未使用、未过期、尝试次数未超限、摘要一致
export function isResetCodeValid(args: {
  usedAt: Date | null;
  expiresAt: Date;
  attempts: number;
  codeHash: string;
  inputHash: string;
  now?: Date;
}): { ok: boolean; reason?: "used" | "expired" | "attempts" | "mismatch" } {
  const now = args.now ?? new Date();
  if (args.usedAt) return { ok: false, reason: "used" };
  if (args.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (args.attempts >= RESET_MAX_ATTEMPTS) return { ok: false, reason: "attempts" };
  if (args.codeHash !== args.inputHash) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

// 密码策略：与注册接口保持一致（6-128 位）
export function isPasswordValid(password: string): boolean {
  return password.length >= 6 && password.length <= 128;
}
