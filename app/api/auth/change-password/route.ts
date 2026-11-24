// 修改自己的密码：POST /api/auth/change-password { currentPassword, newPassword }
// 登录态操作；改密成功后撤销本人其他设备的会话（当前会话保留），防止旧凭据继续可用。
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { requireUser, parseBody, ApiError, handleApiError } from "@/lib/api";
import { hashPassword, verifyPassword, readToken } from "@/lib/auth";
import { consumeLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(6, "新密码至少 6 位").max(72, "新密码过长"),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = await consumeLimit(`pwd-change:user:${user.id}`, 10, 3600);
    if (limit) return limit;

    const body = await parseBody(request, bodySchema);
    if (body.newPassword === body.currentPassword) throw new ApiError(400, "新密码不能与当前密码相同");

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row || !verifyPassword(body.currentPassword, row.passwordHash)) {
      throw new ApiError(400, "当前密码不正确");
    }

    await db.update(users).set({ passwordHash: hashPassword(body.newPassword) }).where(eq(users.id, user.id));

    // 其他设备强制重新登录；当前会话保留
    const token = readToken(request);
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.token, token ?? "")));

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
