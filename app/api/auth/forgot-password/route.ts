import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResetTokens } from "@/db/schema";
import { consumeLimit, requestSource } from "@/lib/rate-limit";
import { generateResetCode, hashCode, RESET_CODE_TTL_MINUTES } from "@/lib/password-reset";

// 发送找回密码验证码：POST /api/auth/forgot-password  { email }
// 安全设计：
// 1. 邮箱不存在也返回统一提示，不暴露「账号是否注册」
// 2. 按来源 + 账号双重限流，防刷接口 / 撞库
// 3. 生成新验证码前让该邮箱旧验证码失效，避免多个有效码并存
// 4. 项目未接入邮件服务：演示模式（RESET_DEV_MODE 非 "false"）把验证码随响应返回，供课堂演示
const bodySchema = z.object({
  email: z.string().trim().max(254).email("邮箱格式不正确"),
});
const OK_MESSAGE = "若该邮箱已注册，验证码已生成，请在 10 分钟内使用";

export async function POST(request: Request) {
  try {
    const sourceLimit = await consumeLimit(`forgot:source:${requestSource(request)}`, 20, 3600);
    if (sourceLimit) return sourceLimit;
  } catch { return Response.json({ error: "服务暂时不可用，请稍后重试" }, { status: 503 }); }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email } = parsed.data;

  const accountLimit = await consumeLimit(`forgot:account:${email.toLowerCase()}`, 5, 900);
  if (accountLimit) return accountLimit;

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return Response.json({ ok: true, message: OK_MESSAGE });

    const code = generateResetCode();
    // 旧验证码全部作废
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.email, email), isNull(passwordResetTokens.usedAt)));
    await db.insert(passwordResetTokens).values({
      email,
      codeHash: hashCode(code),
      expiresAt: sql`now() + ${RESET_CODE_TTL_MINUTES} * interval '1 minute'`,
    });

    const devMode = process.env.RESET_DEV_MODE !== "false";
    return Response.json({
      ok: true,
      message: OK_MESSAGE,
      ...(devMode ? { devCode: code, devNotice: "演示模式：项目未接入邮件服务，验证码直接显示如下" } : {}),
    });
  } catch {
    return Response.json({ error: "验证码发送服务暂时不可用，请稍后重试" }, { status: 503 });
  }
}
