import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamJoinRequests, teamMembers, teams, projects, projectMembers, users } from "@/db/schema";
import { requireUser, requireTeamAccess, parseId, parseBody, ApiError, handleApiError, displayName } from "@/lib/api";
import { canManageInvites } from "@/lib/team-invites";
type Context = { params: Promise<{ id: string }> };
async function access(request: Request, context: Context) {
  const user = await requireUser(request); const id = parseId((await context.params).id);
  const { membership } = await requireTeamAccess(user.id, id);
  if (!canManageInvites(membership)) throw new ApiError(403, "只有负责人或管理员可以审核申请");
  return id;
}
export async function GET(request: Request, context: Context) {
  try {
    const id = await access(request, context);
    const rows = await db.select({ id: teamJoinRequests.id, name: users.name, studentId: users.studentId, email: users.email }).from(teamJoinRequests).innerJoin(users, eq(users.id, teamJoinRequests.userId)).where(and(eq(teamJoinRequests.teamId, id), eq(teamJoinRequests.status, "pending")));
    return Response.json({ requests: rows.map((r) => ({ ...r, displayName: displayName(r) })) });
  } catch (e) { return handleApiError(e); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const id = await access(request, context);
    const body = await parseBody(request, z.object({ requestId: z.number().int().positive(), approve: z.boolean() }));
    await db.transaction(async (tx) => {
      // 锁定团队，避免审批与项目创建交错后遗漏项目成员同步。
      await tx.select().from(teams).where(eq(teams.id, id)).for("update");
      const user = await requireUser(request);
      const { membership } = await requireTeamAccess(user.id, id, "member", tx);
      if (!canManageInvites(membership)) throw new ApiError(403, "只有负责人或管理员可以审核申请");
      const [row] = await tx.select().from(teamJoinRequests).where(and(eq(teamJoinRequests.id, body.requestId), eq(teamJoinRequests.teamId, id))).for("update");
      if (!row || row.status !== "pending") throw new ApiError(409, "申请已处理或不存在，请刷新");
      if (body.approve) {
        await tx.insert(teamMembers).values({ teamId: id, userId: row.userId, role: "member" }).onConflictDoNothing();
        const all = await tx.select({ id: projects.id }).from(projects).where(eq(projects.teamId, id));
        if (all.length) await tx.insert(projectMembers).values(all.map((p) => ({ projectId: p.id, userId: row.userId }))).onConflictDoNothing();
      }
      await tx.update(teamJoinRequests).set({ status: body.approve ? "approved" : "rejected" }).where(eq(teamJoinRequests.id, row.id));
    });
    return Response.json({ ok: true });
  } catch (e) { return handleApiError(e); }
}
