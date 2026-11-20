import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers, projects, projectMembers, tasks, taskCollaborators } from "@/db/schema";
import { requireUser, parseBody, parseId, requireTeamAccess, ApiError, handleApiError } from "@/lib/api";

// 成员角色调整与移除：PUT / DELETE /api/teams/[id]/members/[userId]
// - PUT 改角色：仅 owner 可操作（owner 角色不可通过此接口转移）
// - DELETE 移除：owner/admin 可移除他人；任何成员可移除自己（退出团队）；owner 不能退出自己
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const user = await requireUser(request);
    const { id, userId: target } = await params;
    const teamId = parseId(id, "团队 ID");
    const targetUserId = parseId(target, "用户 ID");
    await requireTeamAccess(user.id, teamId, "owner");

    const body = await parseBody(
      request,
      z.object({ role: z.enum(["admin", "member"], { message: "角色不合法" }) }),
    );

    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
      await requireTeamAccess(user.id, teamId, "owner", tx);
      const [membership] = await tx
        .select({ id: teamMembers.id, role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
        .limit(1);
      if (!membership) throw new ApiError(404, "该用户不是团队成员");
      if (membership.role === "owner") throw new ApiError(400, "不能修改团队创建者的角色");

      await tx.update(teamMembers).set({ role: body.role }).where(eq(teamMembers.id, membership.id));
    });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const user = await requireUser(request);
    const { id, userId: target } = await params;
    const teamId = parseId(id, "团队 ID");
    const targetUserId = parseId(target, "用户 ID");
    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
      const { membership, team } = await requireTeamAccess(user.id, teamId, "member", tx);

      const isSelf = targetUserId === user.id;
      if (!isSelf && (membership.role !== "owner" && membership.role !== "admin")) {
        throw new ApiError(403, "只有团队管理员可以移除成员");
      }
      if (targetUserId === team.ownerId) throw new ApiError(400, "团队创建者不能退出，如需解散请删除团队");

      const [targetMembership] = await tx
        .select({ id: teamMembers.id, role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
        .limit(1);
      if (!targetMembership) throw new ApiError(404, "该用户不是团队成员");
      // admin 不能移除别的 admin / owner（仅 owner 可以）
      if (!isSelf && membership.role === "admin" && targetMembership.role !== "member") {
        throw new ApiError(403, "只有团队创建者可以移除管理员");
      }

      await tx.delete(teamMembers).where(eq(teamMembers.id, targetMembership.id));

      // 同步移出该团队全部项目
      const teamProjects = await tx.select({ id: projects.id }).from(projects).where(eq(projects.teamId, teamId));
      for (const p of teamProjects) {
        const assignedTasks = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, p.id));
        if (assignedTasks.length) await tx.delete(taskCollaborators)
          .where(and(inArray(taskCollaborators.taskId, assignedTasks.map((task) => task.id)), eq(taskCollaborators.userId, targetUserId)));
        await tx
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, targetUserId)));
      }
    });

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
