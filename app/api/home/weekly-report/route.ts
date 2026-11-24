// AI 周报：GET /api/home/weekly-report
// 把「本周（近 7 天）发生了什么」聚合为周报——与日报同源口径，时间窗换成一周。
// 缺省周窗 = 北京时间今天往前 6 天到今天（含今天）。
import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, docs, projects, tasks, teamMembers, teams } from "@/db/schema";
import { requireUser, displayName, handleApiError } from "@/lib/api";
import { participatesInTask } from "@/lib/task-collaborators";
import { buildWeeklyReport } from "@/lib/home-report";

const pad = (n: number) => String(n).padStart(2, "0");
const plusDays = (dateKey: string, n: number) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    // 北京时间今天
    const todayKey = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const weekStart = plusDays(todayKey, -6);
    const weekEnd = todayKey;

    const bjStart = sql`(${weekStart}::timestamp AT TIME ZONE 'Asia/Shanghai')`;
    const bjEnd = sql`(${weekEnd}::timestamp + interval '1 day') AT TIME ZONE 'Asia/Shanghai'`;

    const myTeams = await db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id));
    const teamIds = myTeams.map((t) => t.id);
    if (teamIds.length === 0) {
      return Response.json({
        report: buildWeeklyReport({
          weekStart, weekEnd, weekLabelText: `${weekStart.slice(5).replace("-", "/")} - ${weekEnd.slice(5).replace("-", "/")}`,
          userName: displayName(user), projectCount: 0, projects: [],
          completedThisWeek: 0, createdThisWeek: 0, messagesThisWeek: 0,
          upcoming: [], completedTitles: [], unreadDms: 0,
        }),
      });
    }

    const myProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(inArray(projects.teamId, teamIds), eq(projects.status, "active")));
    const projectIds = myProjects.map((p) => p.id);

    const statusRows = projectIds.length > 0
      ? await db.select({ projectId: tasks.projectId, status: tasks.status, count: sql<number>`count(*)::int` })
          .from(tasks).where(inArray(tasks.projectId, projectIds)).groupBy(tasks.projectId, tasks.status)
      : [];
    const createdRows = projectIds.length > 0
      ? await db.select({ projectId: tasks.projectId, count: sql<number>`count(*)::int` })
          .from(tasks).where(and(inArray(tasks.projectId, projectIds), gte(tasks.createdAt, bjStart), lt(tasks.createdAt, bjEnd))).groupBy(tasks.projectId)
      : [];
    const completedRows = projectIds.length > 0
      ? await db.select({ projectId: tasks.projectId, count: sql<number>`count(*)::int` })
          .from(tasks).where(and(inArray(tasks.projectId, projectIds), eq(tasks.status, "done"), gte(tasks.updatedAt, bjStart), lt(tasks.updatedAt, bjEnd))).groupBy(tasks.projectId)
      : [];
    const messageRows = projectIds.length > 0
      ? await db.select({ projectId: chatMessages.projectId, count: sql<number>`count(*)::int` })
          .from(chatMessages).where(and(inArray(chatMessages.projectId, projectIds), eq(chatMessages.recalled, false), gte(chatMessages.createdAt, bjStart), lt(chatMessages.createdAt, bjEnd))).groupBy(chatMessages.projectId)
      : [];
    const docsRows = projectIds.length > 0
      ? await db.select({ projectId: docs.projectId, count: sql<number>`count(*)::int` })
          .from(docs).where(and(inArray(docs.projectId, projectIds), gte(docs.updatedAt, bjStart), lt(docs.updatedAt, bjEnd))).groupBy(docs.projectId)
      : [];

    const pick = (rows: Array<{ projectId: number; count: number }>, id: number) =>
      rows.find((r) => r.projectId === id)?.count ?? 0;

    const reportProjects = myProjects.map((p) => {
      const st = statusRows.filter((r) => r.projectId === p.id);
      return {
        name: p.name,
        created: pick(createdRows, p.id),
        completed: pick(completedRows, p.id),
        messages: pick(messageRows, p.id),
        docsUpdated: pick(docsRows, p.id),
        taskTotal: st.reduce((sum, r) => sum + r.count, 0),
        taskDone: st.find((r) => r.status === "done")?.count ?? 0,
      };
    });

    // 本周完成任务的标题（最多 5 条）
    const completedTitles = projectIds.length === 0 ? [] : (await db
      .select({ code: sql<string>`${projects.key} || '-' || lpad(${tasks.number}::text, 3, '0')`, title: tasks.title })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(inArray(tasks.projectId, projectIds), eq(tasks.status, "done"), gte(tasks.updatedAt, bjStart), lt(tasks.updatedAt, bjEnd)))
      .orderBy(asc(tasks.updatedAt))
      .limit(5))
      .map((r) => `${r.code} ${r.title}`);

    // 下周关注：未来 7 天内截止且未完成的任务（我参与的）
    const upcoming = projectIds.length === 0 ? [] : (await db
      .select({ code: sql<string>`${projects.key} || '-' || lpad(${tasks.number}::text, 3, '0')`, title: tasks.title, dueOn: tasks.dueOn })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(
        inArray(tasks.projectId, projectIds),
        participatesInTask(user.id),
        ne(tasks.status, "done"),
        gte(tasks.dueOn, plusDays(weekEnd, 1)),
        sql`${tasks.dueOn} <= ${plusDays(weekEnd, 7)}::date`,
      ))
      .orderBy(asc(tasks.dueOn))
      .limit(3))
      .map((r) => `${r.code} ${r.title}（${r.dueOn} 截止）`);

    const report = buildWeeklyReport({
      weekStart,
      weekEnd,
      weekLabelText: `${weekStart.slice(5).replace("-", "月")}日 - ${weekEnd.slice(5).replace("-", "月")}日`,
      userName: displayName(user),
      projectCount: myProjects.length,
      projects: reportProjects,
      completedThisWeek: completedRows.reduce((s, r) => s + r.count, 0),
      createdThisWeek: createdRows.reduce((s, r) => s + r.count, 0),
      messagesThisWeek: messageRows.reduce((s, r) => s + r.count, 0),
      upcoming,
      completedTitles,
      unreadDms: 0,
    });
    return Response.json({ report });
  } catch (error) {
    return handleApiError(error);
  }
}
