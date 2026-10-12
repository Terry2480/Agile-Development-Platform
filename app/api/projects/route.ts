import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers, projects, projectMembers, projectStars, tasks, sprints, users } from "@/db/schema";
import { requireUser, parseBody, requireTeamAccess, handleApiError, displayName, ApiError } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// 项目接口：GET /api/projects?teamId=&q=&starred=1  我可见的项目列表（含任务统计 / 星标 / 当前 Sprint / 成员头像）
//           POST /api/projects  新建项目（团队全员自动成为项目成员）
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const teamIdParam = url.searchParams.get("teamId");
    const q = url.searchParams.get("q")?.trim() ?? "";
    const starredOnly = url.searchParams.get("starred") === "1";

    // 我加入的全部团队（teamId 传入时校验成员身份）
    const myTeams = await db
      .select({ id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id));
    if (teamIdParam) {
      const teamId = Number(teamIdParam);
      if (!myTeams.some((t) => t.id === teamId)) {
        return Response.json({ projects: [] });
      }
    }
    const teamIds = teamIdParam ? [Number(teamIdParam)] : myTeams.map((t) => t.id);
    if (teamIds.length === 0) return Response.json({ projects: [] });
    const teamNameOf = new Map(myTeams.map((t) => [t.id, t.name]));

    // 项目基础列表
    const conditions = [inArray(projects.teamId, teamIds), eq(projects.status, "active")];
    if (q) conditions.push(sql`${projects.name} ILIKE ${"%" + q + "%"}`);
    let rows = await db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.createdAt));

    // 仅收藏
    if (starredOnly) {
      const stars = await db
        .select({ projectId: projectStars.projectId })
        .from(projectStars)
        .where(eq(projectStars.userId, user.id));
      const starredIds = new Set(stars.map((s) => s.projectId));
      rows = rows.filter((p) => starredIds.has(p.id));
    }

    const projectIds = rows.map((p) => p.id);
    if (projectIds.length === 0) return Response.json({ projects: [] });

    // 任务统计（按项目 + 状态分组）
    const taskStats = await db
      .select({ projectId: tasks.projectId, status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds))
      .groupBy(tasks.projectId, tasks.status);

    // 我的星标
    const myStars = await db
      .select({ projectId: projectStars.projectId })
      .from(projectStars)
      .where(and(eq(projectStars.userId, user.id), inArray(projectStars.projectId, projectIds)));
    const starredSet = new Set(myStars.map((s) => s.projectId));

    // 项目成员（头像堆叠，最多展示前几位由前端截取）
    const members = await db
      .select({ projectId: projectMembers.projectId, userId: users.id, name: users.name, studentId: users.studentId })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(inArray(projectMembers.projectId, projectIds));

    // 进行中的 Sprint
    const activeSprints = await db
      .select()
      .from(sprints)
      .where(and(inArray(sprints.projectId, projectIds), eq(sprints.status, "active")));

    const result = rows.map((p) => {
      const stats = { total: 0, todo: 0, doing: 0, done: 0 };
      for (const s of taskStats.filter((t) => t.projectId === p.id)) {
        stats.total += s.count;
        if (s.status in stats) stats[s.status as keyof typeof stats] = s.count;
      }
      const sprint = activeSprints.find((s) => s.projectId === p.id) ?? null;
      return {
        id: p.id,
        teamId: p.teamId,
        teamName: teamNameOf.get(p.teamId) ?? "",
        name: p.name,
        key: p.key,
        description: p.description,
        courseName: p.courseName,
        status: p.status,
        starred: starredSet.has(p.id),
        taskCounts: stats,
        activeSprint: sprint ? { id: sprint.id, name: sprint.name, endsOn: sprint.endsOn, goal: sprint.goal } : null,
        members: members
          .filter((m) => m.projectId === p.id)
          .map((m) => ({ userId: m.userId, name: displayName({ name: m.name, studentId: m.studentId }) })),
      };
    });
    return Response.json({ projects: result });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  teamId: z.number({ message: "请选择团队" }).int().positive("请选择团队"),
  name: z.string().trim().min(1, "请填写项目名称").max(50, "项目名称过长"),
  key: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,5}$/, "项目标识需为 2-6 位大写字母/数字（如 WEB、AGI）"),
  description: z.string().trim().max(500, "项目描述过长").optional().nullable(),
  courseName: z.string().trim().max(100, "课程名称最多 100 个字").optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);
    await requireTeamAccess(user.id, body.teamId);

    const project = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, body.teamId)).for("update");
      await requireTeamAccess(user.id, body.teamId, "member", tx);
      const [created] = await tx
        .insert(projects)
        .values({
          teamId: body.teamId,
          name: body.name,
          key: body.key,
          description: body.description || null,
          courseName: body.courseName || null,
          createdById: user.id,
        })
        .returning()
        .catch((caught: unknown) => {
          const error = caught as { code?: string; cause?: { code?: string } };
          if (error?.cause?.code === "23505" || error?.code === "23505") {
            throw new ApiError(409, `项目标识 ${body.key} 已被团队内其他项目使用`);
          }
          throw error;
        });

      // 团队全员自动成为项目成员
      const allMembers = await tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, body.teamId));
      if (allMembers.length) await tx
        .insert(projectMembers)
        .values(allMembers.map((m) => ({ projectId: created.id, userId: m.userId })))
        .onConflictDoNothing();

      await logActivity({
        projectId: created.id,
        actorId: user.id,
        action: "project.created",
        detail: `${displayName(user)} 创建了项目 ${created.name}（${created.key}）`,
      }, tx);
      return created;
    });

    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
