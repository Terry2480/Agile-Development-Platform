import { z } from "zod";
import { and, eq, inArray, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects, projectMembers, projectStars, sprints, tasks, teamMembers, sessions, labels, users,
} from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// 项目详情 / 更新 / 删除：GET / PUT / DELETE /api/projects/[id]
// GET 返回项目 + 团队信息 + 成员 + Sprint 列表 + 团队标签 + 任务统计 + 是否星标
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project, team, membership } = await requireProjectAccess(user.id, projectId);

    const members = await db
      .select({
        userId: users.id,
        name: users.name,
        studentId: users.studentId,
        email: users.email,
        role: teamMembers.role,
        duty: teamMembers.duty,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(teamMembers, and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, users.id)))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(users.id);

    // 成员在线状态：5 分钟内有活跃会话视为在线
    const memberIds = members.map((m) => m.userId);
    const onlineRows = memberIds.length
      ? await db
          .select({ userId: sessions.userId, lastActiveAt: sessions.lastActiveAt })
          .from(sessions)
          .where(and(inArray(sessions.userId, memberIds), gt(sessions.expiresAt, new Date())))
      : [];
    const fiveMinAgo = Date.now() - 5 * 60_000;
    const onlineSet = new Set(
      onlineRows
        .filter((s) => s.lastActiveAt && new Date(s.lastActiveAt).getTime() > fiveMinAgo)
        .map((s) => s.userId),
    );

    const sprintRows = await db
      .select()
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(sprints.createdAt);

    const labelRows = await db.select().from(labels).where(eq(labels.teamId, project.teamId)).orderBy(labels.createdAt);

    const statsRows = await db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.status);
    const taskCounts = { total: 0, todo: 0, doing: 0, done: 0 };
    for (const s of statsRows) {
      taskCounts.total += s.count;
      if (s.status in taskCounts) taskCounts[s.status as keyof typeof taskCounts] = s.count;
    }

    const [star] = await db
      .select({ id: projectStars.id })
      .from(projectStars)
      .where(and(eq(projectStars.projectId, projectId), eq(projectStars.userId, user.id)))
      .limit(1);

    return Response.json({
      project,
      team: { id: team.id, name: team.name, description: team.description },
      myRole: membership.role,
      members: members.map((m) => ({ ...m, displayName: displayName(m), online: onlineSet.has(m.userId) })),
      sprints: sprintRows,
      labels: labelRows,
      taskCounts,
      starred: Boolean(star),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名称").max(50, "项目名称过长").optional(),
  description: z.string().trim().max(500, "项目描述过长").optional().nullable(),
  status: z.enum(["active", "archived"], { message: "状态不合法" }).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId, "admin");
    const body = await parseBody(request, updateSchema);

    const [updated] = await db
      .update(projects)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(eq(projects.id, projectId))
      .returning();

    if (body.status && body.status !== project.status) {
      await logActivity({
        projectId,
        actorId: user.id,
        action: body.status === "archived" ? "project.archived" : "project.restored",
        detail: `${displayName(user)} ${body.status === "archived" ? "归档了" : "恢复了"}项目 ${updated.name}`,
      });
    }
    return Response.json({ project: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

// 删除项目：owner / admin（级联删除项目全部数据）
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId, "admin");

    await db.delete(projects).where(eq(projects.id, projectId));
    return Response.json({ ok: true, deleted: project.name });
  } catch (error) {
    return handleApiError(error);
  }
}
