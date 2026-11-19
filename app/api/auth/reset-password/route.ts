import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions, passwordResetTokens } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { consumeLimit, requestSource } from "@/lib/rate-limit";
import { hashCode, isResetCodeValid, isPasswordValid } from "@/lib/password-reset";

// 重置密码：POST /api/auth/reset-password  { email, code, newPassword }
// 验证码错误时累加 attempts（上限 5 次）；成功后标记已用、删除该用户所有会话强制重新登录。
const bodySchema = z.object({
  email: z.string().trim().max(254).email("邮箱格式不正确"),
  code: z.string().trim().length(6, "请输入 6 位验证码"),
  newPassword: z.string().min(6, "密码至少 6 位").max(128, "密码最多 128 个字符"),
});

export async function POST(request: Request) {
  try {
    const blocked = await consumeLimit(`reset:source:${requestSource(request)}`, 20, 3600);
    if (blocked) return blocked;
  } catch { return Response.json({ error: "服务暂时不可用，请稍后重试" }, { status: 503 }); }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email, code, newPassword } = parsed.data;
  if (!isPasswordValid(newPassword)) return Response.json({ error: "密码需为 6-128 位" }, { status: 400 });

  const accountLimit = await consumeLimit(`reset:account:${email.toLowerCase()}`, 10, 900);
  if (accountLimit) return accountLimit;

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return Response.json({ error: "验证码无效或已过期，请重新获取" }, { status: 400 });

    // 取该邮箱最近一条验证码
    const [record] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.email, email))
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(1);
    if (!record) return Response.json({ error: "尚未获取验证码，请先发送验证码" }, { status: 400 });

    const check = isResetCodeValid({
      usedAt: record.usedAt,
      expiresAt: record.expiresAt,
      attempts: record.attempts,
      codeHash: record.codeHash,
      inputHash: hashCode(code),
    });
    if (!check.ok) {
      if (check.reason === "mismatch") {
        await db.update(passwordResetTokens)
          .set({ attempts: sql`${passwordResetTokens.attempts} + 1` })
          .where(eq(passwordResetTokens.id, record.id));
      }
      const message =
        check.reason === "expired" ? "验证码已过期，请重新获取" :
        check.reason === "attempts" ? "尝试次数过多，请重新获取验证码" :
        check.reason === "used" ? "该验证码已使用，请重新获取" :
        "验证码不正确，请重新输入";
      return Response.json({ error: message }, { status: 400 });
    }

    // 成功：改密码 + 标记验证码已用 + 删除所有会话（强制重新登录）
    await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    return Response.json({ ok: true, message: "密码已重置，请用新密码登录" });
  } catch {
    return Response.json({ error: "重置服务暂时不可用，请稍后重试" }, { status: 503 });
  }
}
