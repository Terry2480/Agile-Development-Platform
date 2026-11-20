import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { requireUser, requireTeamAccess, parseId, parseBody, ApiError, handleApiError } from "@/lib/api";
import { canManageDuties, dutiesSchema, LEADER_DUTY } from "@/lib/team-duties";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const user = await requireUser(request);
    const { id, userId } = await params;
    const teamId = parseId(id, "团队 ID");
    const targetUserId = parseId(userId, "用户 ID");
    const body = await parseBody(request, dutiesSchema);
    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
      const { membership } = await requireTeamAccess(user.id, teamId, "member", tx);
      if (!canManageDuties(membership)) throw new ApiError(403, "只有负责人可以分配分工标签");
      const [target] = await tx.select().from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId))).limit(1);
      if (!target) throw new ApiError(404, "该用户不是团队成员");
      if (target.role === "owner" && !body.duties.includes(LEADER_DUTY)) {
        throw new ApiError(400, "团队创建者保留负责人分工，确保团队始终有人管理分工");
      }
      await tx.update(teamMembers).set({
        duties: body.duties,
        duty: body.duties.includes(LEADER_DUTY) ? LEADER_DUTY : body.duties[0] ?? null,
      }).where(eq(teamMembers.id, target.id));
    });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
