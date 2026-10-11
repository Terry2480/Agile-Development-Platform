import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { teamInvites, teamJoinRequests, teamMembers, teams } from "@/db/schema";
import { requireUser, parseBody, ApiError, handleApiError } from "@/lib/api";
import { joinCodeSchema } from "@/lib/team-invites";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { code } = await parseBody(request, joinCodeSchema);
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(teamInvites).where(eq(teamInvites.code, code)).for("share");
      if (!invite || invite.expiresAt <= new Date()) throw new ApiError(400, "邀请码无效或已过期，请联系团队负责人");
      const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)));
      if (member) throw new ApiError(409, "你已经是该团队成员");
      const [row] = await tx.insert(teamJoinRequests).values({ teamId: invite.teamId, userId: user.id }).onConflictDoUpdate({ target: [teamJoinRequests.teamId, teamJoinRequests.userId], set: { status: "pending", createdAt: new Date() } }).returning();
      return row;
    });
    return Response.json({ request: result }, { status: 201 });
  } catch (e) { return handleApiError(e); }
}
export async function GET(request: Request) {
  try { const user = await requireUser(request); const rows = await db.select({ id: teamJoinRequests.id, teamName: teams.name, status: teamJoinRequests.status }).from(teamJoinRequests).innerJoin(teams, eq(teams.id, teamJoinRequests.teamId)).where(eq(teamJoinRequests.userId, user.id)).orderBy(desc(teamJoinRequests.createdAt)); return Response.json({ requests: rows }); } catch (e) { return handleApiError(e); }
}
