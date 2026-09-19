import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  milestones,
  projectDocuments,
  projects,
  teamMembers,
  teams,
  tasks,
  type ProjectStatus,
  type ProjectType,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership, requireTeamRole } from "./team";

export async function createProject(
  actorId: string,
  teamId: string,
  input: {
    name: string;
    description?: string;
    projectType?: ProjectType;
    startDate?: string;
    endDate?: string;
  },
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        teamId,
        name: input.name,
        description: input.description,
        projectType: input.projectType ?? "course",
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();

    const documentTemplates = [
      { title: "项目说明", kind: "custom" as const, content: "# 项目目标\n\n## 要解决的问题\n\n## 预期成果\n" },
      { title: "会议纪要", kind: "meeting" as const, content: "# 会议纪要\n\n日期：\n参与成员：\n\n## 讨论内容\n\n## 决策与待办\n" },
    ];
    await tx.insert(projectDocuments).values(
      documentTemplates.map((document) => ({
        projectId: project.id,
        ...document,
        createdById: actorId,
        updatedById: actorId,
      })),
    );

    return project;
  });
}

export async function listTeamProjects(actorId: string, teamId: string) {
  await requireTeamRole(actorId, teamId, ["admin", "teacher", "student"]);
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.createdAt));
}

// 项目编辑/归档：仅团队 admin 可动（与 createProject 同一权限口径）
export async function updateProject(
  actorId: string,
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    status?: ProjectStatus;
  },
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (access.role !== "admin") throw new ForbiddenError();

  // 显式白名单构造，勿用 ...patch 展开：运行时宽对象可夹带 teamId 等越权字段（同 task.ts 之诫）
  const [updated] = await db
    .update(projects)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.endDate !== undefined && { endDate: patch.endDate }),
      ...(patch.status !== undefined && { status: patch.status }),
    })
    .where(eq(projects.id, projectId))
    .returning();
  if (!updated) throw new AppError("项目不存在");
  return updated;
}

// 项目详情聚合：项目本体 + 里程碑 + 任务状态计数。供 Agent API 一次取回全貌。
export async function getProjectDetail(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [projectMilestones, counts] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.status),
  ]);

  const byStatus = { todo: 0, doing: 0, done: 0 };
  for (const c of counts) byStatus[c.status] = c.count;

  return {
    project: access.project,
    role: access.role,
    milestones: projectMilestones,
    taskTotal: byStatus.todo + byStatus.doing + byStatus.done,
    byStatus,
  };
}

// 页面/任务层的访问收敛点：项目不存在或非团队成员一律 null，不泄露存在性
export async function getProjectForUser(actorId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const membership = await getTeamMembership(actorId, project.teamId);
  if (!membership) return null;
  return { project, role: membership.role };
}

export async function createMilestone(
  actorId: string,
  projectId: string,
  input: { title: string; targetDate?: string },
) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || access.role !== "admin") throw new ForbiddenError();
  const [milestone] = await db
    .insert(milestones)
    .values({ projectId, title: input.title, targetDate: input.targetDate })
    .returning();
  return milestone;
}

export async function listProjectMilestones(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(milestones.targetDate);
}

// 跨团队聚合：我所在全部团队的项目 + 团队名 + 任务统计
export async function listMyProjects(actorId: string) {
  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, actorId));
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return [];

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectType: projects.projectType,
      status: projects.status,
      teamId: projects.teamId,
      teamName: teams.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .where(inArray(projects.teamId, teamIds))
    .orderBy(desc(projects.createdAt));

  if (rows.length === 0) return [];

  const stats = await db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      inArray(
        tasks.projectId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(tasks.projectId, tasks.status);

  return rows.map((p) => {
    const mine = stats.filter((s) => s.projectId === p.id);
    const total = mine.reduce((n, s) => n + s.count, 0);
    const doneCount = mine.find((s) => s.status === "done")?.count ?? 0;
    return { ...p, taskTotal: total, doneCount };
  });
}
