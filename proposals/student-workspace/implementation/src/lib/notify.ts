import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users, projects } from "@/db/schema";
import { sendCardMessage } from "./feishu";
import {
  buildAssignedCard,
  buildCompletedCard,
  buildDueReminderCard,
  type CardTask,
  type ReminderItem,
} from "./feishu-card";

// notify 收的 task 来自 createTask/updateTask 返回 row，含 projectId/priority
type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeId: string | null;
  projectId: string;
  priority: string;
  completionNote?: string | null;
  createdById?: string | null;
};

// 取用户 open_id（未绑返回 null）
async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 补查卡片所需的 项目名 / 负责人名
async function enrich(task: TaskRow): Promise<CardTask> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId));
  let assigneeName: string | null = null;
  if (task.assigneeId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, task.assigneeId));
    assigneeName = u?.name ?? null;
  }
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: proj?.name ?? "（未知项目）",
    assigneeName,
    dueDate: task.dueDate,
    priority: task.priority,
    completionNote: task.completionNote ?? null,
  };
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget，通知不得阻断主业务）
async function safeSend(openId: string, card: unknown): Promise<boolean> {
  try {
    await sendCardMessage(openId, card);
    return true;
  } catch (e) {
    console.error("[notify] 飞书发送失败", e);
    return false;
  }
}

export async function notifyTaskAssigned(task: TaskRow): Promise<void> {
  if (!task.assigneeId) return;
  const openId = await openIdOf(task.assigneeId);
  if (!openId) return;
  await safeSend(openId, buildAssignedCard(await enrich(task)));
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildCompletedCard(await enrich(task)));
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为一封卡片日报。返回发送人数与扫描任务数。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  // 临期/逾期：status≠done 且 dueDate ≤ 明日（含逾期），且负责人已绑飞书
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      openId: users.feishuOpenId,
    })
    .from(tasks)
    .innerJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        isNotNull(users.feishuOpenId),
        // dueDate <= 明日（date 列与 CURRENT_DATE 比较）
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

  // 按负责人聚合
  const byUser = new Map<string, { openId: string; overdue: ReminderItem[]; dueSoon: ReminderItem[] }>();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    if (!r.assigneeId || !r.openId) continue;
    const bucket = byUser.get(r.assigneeId) ?? { openId: r.openId, overdue: [], dueSoon: [] };
    const item: ReminderItem = { id: r.id, title: r.title, projectId: r.projectId };
    if (r.dueDate && r.dueDate < todayStr) bucket.overdue.push(item);
    else bucket.dueSoon.push(item);
    byUser.set(r.assigneeId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const ok = await safeSend(openId, buildDueReminderCard({ overdue, dueSoon }));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
