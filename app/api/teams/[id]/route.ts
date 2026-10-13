import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers, users } from "@/db/schema";
import { requireUser, parseBody, parseId, requireTeamAccess, handleApiError, displayName } from "@/lib/api";
import { tryFileCleanup } from "@/lib/file-cleanup";
import { memberOnline } from "@/lib/presence";

// 团队详情：GET / PUT / DELETE /api/teams/[id]
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    const { team, membership } = await requireTeamAccess(user.id, teamId);

    const members = await db
      .select({
        userId: users.id,
        name: users.name,
        studentId: users.studentId,
        email: users.email,
        gender: users.gender,
        role: teamMembers.role,
        duty: teamMembers.duty,
        duties: teamMembers.duties,
        online: memberOnline(users.id),
        joinedAt: teamMembers.joinedAt,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(teamMembers.joinedAt);

    return Response.json({ team, myRole: membership.role, members: members.map((m) => ({ ...m, displayName: displayName(m) })) });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "请填写团队名称").max(50, "团队名称过长").optional(),
  description: z.string().trim().max(200, "团队简介过长").optional().nullable(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    await requireTeamAccess(user.id, teamId, "admin");
    const body = await parseBody(request, updateSchema);

    const [team] = await db
      .update(teams)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
      })
      .where(eq(teams.id, teamId))
      .returning();

    return Response.json({ team });
  } catch (error) {
    return handleApiError(error);
  }
}

// 解散团队：仅 owner（级联删除团队下全部项目与数据）
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    await requireTeamAccess(user.id, teamId, "owner");

    await db.delete(teams).where(and(eq(teams.id, teamId), eq(teams.ownerId, user.id)));
    await tryFileCleanup();
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
