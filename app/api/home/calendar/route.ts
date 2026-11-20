// 首页日历：GET /api/home/calendar?month=YYYY-MM
// 返回我所在项目当月的任务截止 + 里程碑事件（点击日期查看当日安排）。
// month 缺省按北京时间当前月；事件状态随任务实时变化。
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { milestones, projects, tasks, teamMembers, teams } from "@/db/schema";
import { requireUser, handleApiError } from "@/lib/api";
import { assertMonthKey, monthRange, type CalendarEvent } from "@/lib/calendar-events";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const monthParam = url.searchParams.get("month");
    const month = monthParam
      ? assertMonthKey(monthParam)
      : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7); // 北京时间当前月
    const { start, end } = monthRange(month);

    const myTeams = await db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id));
    const teamIds = myTeams.map((t) => t.id);
    if (teamIds.length === 0) return Response.json({ month, events: [] });

    const myProjects = await db
      .select({ id: projects.id, name: projects.name, key: projects.key })
      .from(projects)
      .where(and(inArray(projects.teamId, teamIds), eq(projects.status, "active")));
    const projectName = new Map(myProjects.map((p) => [p.id, p.name]));
    const projectIds = myProjects.map((p) => p.id);
    if (projectIds.length === 0) return Response.json({ month, events: [] });

    // 任务截止：我所在项目、未完成、当月有 dueOn 的任务
    //（date 列以 YYYY-MM-DD 字符串取出，与边界直接字典序比较）
    const taskEvents: CalendarEvent[] = (await db
      .select({ dueOn: tasks.dueOn, title: tasks.title, status: tasks.status, number: tasks.number, projectId: tasks.projectId, key: projects.key })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(
        inArray(tasks.projectId, projectIds),
        inArray(tasks.status, ["todo", "doing"]),
        isNotNull(tasks.dueOn),
        gte(tasks.dueOn, start),
        lte(tasks.dueOn, end),
      ))
      .orderBy(asc(tasks.dueOn)))
      .map((r) => ({
        date: r.dueOn as string,
        kind: "task" as const,
        title: r.title,
        code: `${r.key}-${String(r.number).padStart(3, "0")}`,
        status: r.status,
        projectId: r.projectId,
        projectName: projectName.get(r.projectId) ?? "",
      }));

    // 里程碑：我所在项目、当月到期
    const milestoneEvents: CalendarEvent[] = (await db
      .select({ dueOn: milestones.dueOn, title: milestones.name, projectId: milestones.projectId })
      .from(milestones)
      .where(and(inArray(milestones.projectId, projectIds), gte(milestones.dueOn, start), lte(milestones.dueOn, end)))
      .orderBy(asc(milestones.dueOn)))
      .map((r) => ({
        date: r.dueOn,
        kind: "milestone" as const,
        title: r.title,
        projectId: r.projectId,
        projectName: projectName.get(r.projectId) ?? "",
      }));

    const events = [...milestoneEvents, ...taskEvents].sort((a, b) => a.date.localeCompare(b.date));
    return Response.json({ month, events });
  } catch (error) {
    return handleApiError(error);
  }
}
