import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users, activities, milestones, milestoneTasks } from "@/db/schema";
import { requireUser, requireProjectAccess, parseId, ApiError, handleApiError, taskCode } from "@/lib/api";
import { reportRangeSchema, reportToday, type ReportSummary } from "@/lib/report-summary";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id);
    const { project } = await requireProjectAccess(user.id, projectId);
    const url = new URL(request.url);
    const range = reportRangeSchema.safeParse({ start: url.searchParams.get("start"), end: url.searchParams.get("end") });
    if (!range.success) throw new ApiError(400, "请选择有效的日期范围，开始日期不能晚于结束日期");
    const { start, end } = range.data;
    const since = new Date(`${start}T00:00:00+08:00`);
    const until = new Date(new Date(`${end}T00:00:00+08:00`).getTime() + 86400000);
    const now = new Date();
    const data = await db.transaction(async (tx) => {
      const rows = await tx.select({ task: tasks, name: users.name, studentId: users.studentId }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(tasks.projectId, projectId)).orderBy(tasks.number);
      const events = await tx.select().from(activities).where(and(eq(activities.projectId, projectId), eq(activities.action, "task.status_changed"))).orderBy(desc(activities.createdAt), desc(activities.id));
      const latest = new Map<number, typeof events[number]>();
      for (const event of events) if (event.taskId !== null && !latest.has(event.taskId)) latest.set(event.taskId, event);
      const completedIds = new Set([...latest.values()].filter((a) => a.detail.endsWith("移至「已完成」") && a.createdAt && a.createdAt >= since && a.createdAt < until).map((a) => a.taskId));
      const list = rows.map(({ task: t, name, studentId }) => ({ id: t.id, code: taskCode(project.key, t.number), title: t.title, status: t.status, dueOn: t.dueOn, assignee: name || studentId || "未分配" }));
      const milestoneRows = await tx.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(milestones.dueOn);
      const links = await tx.select({ milestoneId: milestoneTasks.milestoneId, status: tasks.status }).from(milestoneTasks).innerJoin(tasks, eq(tasks.id, milestoneTasks.taskId)).where(eq(tasks.projectId, projectId));
      return {
        projectName: project.name, start, end, generatedAt: now.toISOString(),
        completed: list.filter((t) => {
          if (t.status !== "done") return false;
          const original = rows.find((r) => r.task.id === t.id)!.task;
          // 创建时直接标为完成且之后没有修改的任务，也属于期间完成。
          const createdDone = original.createdAt && original.updatedAt && original.createdAt.getTime() === original.updatedAt.getTime() && original.createdAt >= since && original.createdAt < until;
          return completedIds.has(t.id) || Boolean(createdDone);
        }),
        doing: list.filter((t) => t.status === "doing"),
        overdue: list.filter((t) => t.status !== "done" && t.dueOn && t.dueOn < reportToday(now)),
        milestones: milestoneRows.map((m) => { const linked = links.filter((l) => l.milestoneId === m.id); return { id: m.id, name: m.name, dueOn: m.dueOn, completed: m.completed, total: linked.length, done: linked.filter((l) => l.status === "done").length }; }),
      } satisfies ReportSummary;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    return Response.json({ report: data });
  } catch (e) { return handleApiError(e); }
}
