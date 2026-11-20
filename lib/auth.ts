import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { eq, and, gt, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { sessionCookie } from "./request-security";
import { sessionNow } from "./presence";

// ── 登录会话 ──────────────────────────────────────────────
// 方案：登录成功后生成随机令牌，一份存 sessions 表，一份放进 httpOnly Cookie；
// 每次请求带 Cookie 来换当前用户。退出 = 删表记录 + 清 Cookie。

export const SESSION_COOKIE = "agile_session";
const SESSION_DAYS = 7; // 会话有效期 7 天

// 密码加密：scrypt + 随机盐，存储格式 "盐:哈希"，永不存明文
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// 密码校验：用存储的盐重新计算一次，常量时间比较防时序攻击
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const calc = scryptSync(password, salt, 64);
  const origin = Buffer.from(hash, "hex");
  return calc.length === origin.length && timingSafeEqual(calc, origin);
}

// 创建会话：写入 sessions 表，返回可直接下发的 Set-Cookie 字符串
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    token, userId,
    expiresAt: sql`${sessionNow()} + ${SESSION_DAYS} * interval '1 day'`,
    lastActiveAt: sessionNow(),
  });
  return sessionCookie(token, SESSION_DAYS * 86400);
}

// 注销会话：删除表记录，返回清空 Cookie 的 Set-Cookie 字符串
export async function destroySession(token: string): Promise<string> {
  await db.delete(sessions).where(eq(sessions.token, token));
  return sessionCookie("", 0);
}

// 从请求头里解析出会话令牌
export function readToken(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

// 当前登录用户：会话有效则返回用户（不含密码），否则 null
// 顺带滚动更新会话活跃时间（节流 1 分钟），供成员在线状态使用
export async function getSessionUser(request: Request) {
  const token = readToken(request);
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, studentId: users.studentId,
      gender: users.gender, region: users.region, bio: users.bio, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, sessionNow())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(sessions).set({ lastActiveAt: sessionNow() }).where(and(
    eq(sessions.token, token),
    gt(sessions.expiresAt, sessionNow()),
    or(isNull(sessions.lastActiveAt), lt(sessions.lastActiveAt, sql`${sessionNow()} - interval '1 minute'`)),
  ));
  return row;
}
