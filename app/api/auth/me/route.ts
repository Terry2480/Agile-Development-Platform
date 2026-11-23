import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

// 我的资料：GET /api/auth/me 返回当前登录用户；PUT /api/auth/me 更新自己的资料
// 「仅个人能更改」由服务端保证：只能改当前会话用户自己的那一行
// 名称（展示名）可不填；学工号为唯一标识，必填且不能与他人重复
const profileSchema = z.object({
  name: z.string().trim().max(40, "名称最长 40 字").optional().nullable(),
  studentId: z.string().trim().min(1, "学工号不能为空").max(20, "学工号过长"),
  gender: z.string().trim().max(10, "性别取值过长").optional().nullable(),
  region: z.string().trim().max(30, "地区最长 30 字").optional().nullable(),
  bio: z.string().trim().max(500, "个人简介最长 500 字").optional().nullable(),
});

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  return Response.json({ user });
}

export async function PUT(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "未登录，请先登录" }, { status: 401 });
  const parsed = profileSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    // 只更新当前用户自己的资料（where id = 会话用户 id）
    const [updated] = await db.update(users).set({
      name: parsed.data.name || null,
      studentId: parsed.data.studentId,
      gender: parsed.data.gender || null,
      region: parsed.data.region || null,
      bio: parsed.data.bio || null,
    }).where(eq(users.id, user.id))
      .returning({ id: users.id, email: users.email, name: users.name, studentId: users.studentId,
        gender: users.gender, region: users.region, bio: users.bio, role: users.role });
    return Response.json({ user: updated });
  } catch (caught: unknown) {
    const error = caught as { code?: string; cause?: { code?: string } };
    if (error?.cause?.code === "23505" || error?.code === "23505") return Response.json({ error: "该学工号已被其他成员使用" }, { status: 409 });
    return Response.json({ error: "服务器异常，请稍后重试" }, { status: 500 });
  }
}
