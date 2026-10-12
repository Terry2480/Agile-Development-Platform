import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, createSession } from "@/lib/auth";
import { consumeLimit, requestSource } from "@/lib/rate-limit";

// 注册接口：POST /api/auth/register  { email, password, studentId }
// 学工号注册必填且唯一（高校场景以学工号区分成员，不强制填写真实姓名）
// 注册成功即自动登录（直接签发会话 Cookie）
const bodySchema = z.object({
  email: z.string().trim().max(254).email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位").max(128, "密码最多 128 个字符"),
  studentId: z.string().trim().min(1, "请填写学工号").max(80, "学工号过长"),
});

export async function POST(request: Request) {
  try {
    const blocked = await consumeLimit(`register:source:${requestSource(request)}`, 20, 3600);
    if (blocked) return blocked;
  } catch { return Response.json({ error: "注册服务暂时不可用，请稍后重试" }, { status: 503 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email, password, studentId } = parsed.data;
  try {
    const [user] = await db.insert(users).values({ email, studentId, passwordHash: hashPassword(password) })
      .returning({ id: users.id, email: users.email, studentId: users.studentId });
    const setCookie = await createSession(user.id);
    return Response.json({ user }, { headers: { "Set-Cookie": setCookie } });
  } catch (caught: unknown) {
    const error = caught as { code?: string; constraint?: string; detail?: string; cause?: { code?: string; constraint?: string; detail?: string } };
    // Postgres 唯一约束冲突（23505）：按冲突的约束名区分提示（Drizzle 会把原始错误包在 cause 里）
    if (error?.cause?.code === "23505" || error?.code === "23505") {
      const constraint = String(error?.cause?.constraint ?? error?.constraint ?? error?.cause?.detail ?? "");
      const message = /student_id/i.test(constraint) ? "该学工号已被注册" : "该邮箱已被注册";
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: "服务器异常，请稍后重试" }, { status: 500 });
  }
}
