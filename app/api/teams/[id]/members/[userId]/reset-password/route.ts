// 管理员重置成员密码：POST /api/teams/[id]/members/[userId]/reset-password
// 场景：项目未接入邮件服务，成员忘记密码时由团队负责人/管理员生成一次性临时密码，
// 线下告知本人；成员登录后请在「个人设置」自行修改。
// 权限：owner/admin；不能重置自己与团队创建者；重置后目标用户全部会话失效（强制重登）。
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, teamMembers, users } from "@/db/schema";
import { requireUser, parseId, requireTeamAccess, ApiError, handleApiError } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

const TEMP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去易混淆字符（0O1I）

function generateTempPassword(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += TEMP_CHARS[bytes[i] % TEMP_CHARS.length];
  return out;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id, userId: target } = await params;
    const teamId = parseId(id, "团队 ID");
    const targetUserId = parseId(target, "用户 ID");

    const { membership: actorMembership } = await requireTeamAccess(actor.id, teamId);
    if (actorMembership.role !== "owner" && actorMembership.role !== "admin") {
      throw new ApiError(403, "只有团队创建者或管理员可以重置成员密码");
    }
    if (targetUserId === actor.id) throw new ApiError(400, "重置自己的密码请在「个人设置」操作");

    const [targetMembership] = await db
      .select({ id: teamMembers.id, role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
      .limit(1);
    if (!targetMembership) throw new ApiError(404, "该用户不是团队成员");
    if (targetMembership.role === "owner") throw new ApiError(400, "不能重置团队创建者的密码");

    const tempPassword = generateTempPassword();
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: hashPassword(tempPassword) }).where(eq(users.id, targetUserId));
      await tx.delete(sessions).where(eq(sessions.userId, targetUserId)); // 全部会话失效，强制重登
    });

    return Response.json({ ok: true, tempPassword });
  } catch (error) {
    return handleApiError(error);
  }
}
