import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, createSession } from "@/lib/auth";
import { consumeLimit, requestSource } from "@/lib/rate-limit";

// 登录接口：POST /api/auth/login  { email, password }
const bodySchema = z.object({
  email: z.string().trim().max(254).email("邮箱格式不正确"),
  password: z.string().min(1, "请填写密码").max(1024, "密码过长"),
});

export async function POST(request: Request) {
  try {
  const sourceLimit = await consumeLimit(`login:source:${requestSource(request)}`, 100, 900);
  if (sourceLimit) return sourceLimit;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email, password } = parsed.data;
  const accountLimit = await consumeLimit(`login:account:${email.toLowerCase()}`, 10, 900);
  if (accountLimit) return accountLimit;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // 邮箱不存在与密码错误返回同一句提示，避免暴露「邮箱是否已注册」
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }
  const setCookie = await createSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email, name: user.name } },
    { headers: { "Set-Cookie": setCookie } });
  } catch {
    return Response.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 503 });
  }
}
