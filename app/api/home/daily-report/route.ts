// AI 日报：GET /api/home/daily-report?date=YYYY-MM-DD
// 把「我在所有项目里今天发生了什么」聚合成本地规则引擎生成的中文日报。
// date 缺省按北京时间今天算；时区换算统一走 Asia/Shanghai（服务器时钟为 UTC）。
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, dmConversations, dmMessages, docs, milestones, notifications, projects, tasks, teamMembers, teams, users } from "@/db/schema";
import { requireUser, displayName, handleApiError } from "@/lib/api";
import { participatesInTask } from "@/lib/task-collaborators";
import { assertDateKey, splitDateKey } from "@/lib/calendar-events";
import { buildDailyReport, type ReportProjectInput } from "@/lib/home-report";

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const plusDays = (dateKey: string, n: number) => {
  const { year, month, day } = splitDateKey(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return d.toISOString().slice(0, 10);
};

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const dateKey = dateParam
      ? assertDateKey(dateParam)
      : new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); // 北京时间今天
    const tomorrow = plusDays(dateKey, 1);

    // 北京时区的「今天」起止时刻（timestamptz 瞬时值；无时区列按 UTC 存储，会话时区为 UTC，比较语义一致）
    const bjStart = sql`(${dateKey}::timestamp AT TIME ZONE 'Asia/Shanghai')`;
    const bjEnd = sql`(${dateKey}::timestamp + interval '1 day') AT TIME ZONE 'Asia/Shanghai'`;

    /* ---------- 我的项目 ---------- */
    const myTeams = await db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id));
    const teamIds = myTeams.map((t) => t.id);
    if (teamIds.length === 0) {
      const empty = buildDailyReport({
        dateKey, dateText: dateTextOf(dateKey), userName: displayName(user), projectCount: 0,
        myTodo: 0, myDoing: 0, myDone: 0, deadlineToday: [], overdue: [], deadlineTomorrow: [],
        unreadDms: 0, unreadNotifications: 0, projects: [], milestonesUpcoming: [], mentionsToday: [],
      });
      return Response.json({ report: empty });
    }
    const myProjects = await db
      .select({ id: projects.id, name: projects.name, key: projects.key })
      .from(projects)
      .where(and(inArray(projects.teamId, teamIds), eq(projects.status, "active")));
    const projectIds = myProjects.map((p) => p.id);
    const projectName = new Map(myProjects.map((p) => [p.id, p.name]));

    /* ---------- 项目维度统计 ---------- */
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

    const reportProjects: ReportProjectInput[] = myProjects.map((p) => {
      const st = statusRows.filter((r) => r.projectId === p.id);
      const total = st.reduce((s, r) => s + r.count, 0);
      return {
        id: p.id,
        name: p.name,
        taskTotal: total,
        taskDone: st.find((r) => r.status === "done")?.count ?? 0,
        taskDoing: st.find((r) => r.status === "doing")?.count ?? 0,
        createdToday: pick(createdRows, p.id),
        completedToday: pick(completedRows, p.id),
        messagesToday: pick(messageRows, p.id),
        docsUpdatedToday: pick(docsRows, p.id),
      };
    });

    /* ---------- 我的任务口径（与 /api/overview 的 participatesInTask 一致） ---------- */
    const mineStat = projectIds.length > 0
      ? await db.select({ status: tasks.status, count: sql<number>`count(*)::int` })
          .from(tasks).where(and(inArray(tasks.projectId, projectIds), participatesInTask(user.id))).groupBy(tasks.status)
      : [];
    const myTodo = mineStat.find((r) => r.status === "todo")?.count ?? 0;
    const myDoing = mineStat.find((r) => r.status === "doing")?.count ?? 0;
    const myDone = mineStat.find((r) => r.status === "done")?.count ?? 0;

    /* ---------- 截止/逾期（我参与且未完成的，带编号） ---------- */
    const dueTasks = (cond: ReturnType<typeof and>) =>
      projectIds.length === 0 ? [] : db
        .select({ code: sql<string>`${projects.key} || '-' || lpad(${tasks.number}::text, 3, '0')`, title: tasks.title, dueOn: tasks.dueOn })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(inArray(tasks.projectId, projectIds), participatesInTask(user.id), ne(tasks.status, "done"), cond))
        .orderBy(asc(tasks.dueOn));
    const label = (t: { code: string; title: string }) => `${t.code} ${t.title}`;
    const deadlineToday = (await dueTasks(and(eq(tasks.dueOn, dateKey)))).map(label);
    const deadlineTomorrow = (await dueTasks(and(eq(tasks.dueOn, tomorrow)))).map(label);
    const overdue = (await dueTasks(and(lt(tasks.dueOn, dateKey)))).map(label);

    /* ---------- 里程碑（未来 30 天） ---------- */
    const milestonesUpcoming = projectIds.length === 0 ? [] : await db
      .select({ projectName: projects.name, title: milestones.name, dueOn: milestones.dueOn })
      .from(milestones)
      .innerJoin(projects, eq(projects.id, milestones.projectId))
      .where(and(inArray(milestones.projectId, projectIds), gte(milestones.dueOn, dateKey), lte(milestones.dueOn, plusDays(dateKey, 30))))
      .orderBy(asc(milestones.dueOn))
      .limit(5);

    /* ---------- 今天 @ 我的聊天 ---------- */
    const mentionName = displayName(user);
    const mentionRows = projectIds.length === 0 ? [] : await db
      .select({ content: chatMessages.content, projectId: chatMessages.projectId,
        authorName: users.name, authorStudentId: users.studentId })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorId))
      .where(and(
        inArray(chatMessages.projectId, projectIds),
        eq(chatMessages.recalled, false),
        ne(chatMessages.authorId, user.id),
        gte(chatMessages.createdAt, bjStart), lt(chatMessages.createdAt, bjEnd),
        sql`${chatMessages.content} LIKE ${"%@" + escapeLike(mentionName) + "%"}`,
      ))
      .orderBy(asc(chatMessages.id))
      .limit(5);
    const mentionsToday = mentionRows.map((r) => {
      const text = r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content;
      return `【${projectName.get(r.projectId) ?? ""}】${displayName({ name: r.authorName, studentId: r.authorStudentId })}：${text}`;
    });

    /* ---------- 未读私信与通知 ---------- */
    const [dmUnreadRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dmMessages)
      .innerJoin(dmConversations, eq(dmConversations.id, dmMessages.conversationId))
      .where(and(
        or(eq(dmConversations.userAId, user.id), eq(dmConversations.userBId, user.id)),
        ne(dmMessages.senderId, user.id),
        isNull(dmMessages.readAt),
      ));
    const [notifUnreadRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));

    const report = buildDailyReport({
      dateKey,
      dateText: dateTextOf(dateKey),
      userName: displayName(user),
      projectCount: myProjects.length,
      myTodo, myDoing, myDone,
      deadlineToday, overdue, deadlineTomorrow,
      unreadDms: dmUnreadRow?.count ?? 0,
      unreadNotifications: notifUnreadRow?.count ?? 0,
      projects: reportProjects,
      milestonesUpcoming,
      mentionsToday,
    });
    return Response.json({ report });
  } catch (error) {
    return handleApiError(error);
  }
}

/** YYYY-MM-DD → "M月D日 星期X"（按该日期本身，不依赖服务器时区） */
function dateTextOf(dateKey: string): string {
  const { year, month, day } = splitDateKey(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const names = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${month}月${day}日 ${names[weekday]}`;
}
