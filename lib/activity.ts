import { db } from "@/db";
import { activities } from "@/db/schema";

/* 项目日志：任务 / 项目 / Sprint 等关键变更写入 activities 表，项目空间栏按时间倒序展示 */

// 写一条活动记录。action 为机器可读事件名（如 task.status_changed），detail 为已拼好的中文句子
export async function logActivity(input: {
  projectId: number;
  actorId: number;
  action: string;
  detail: string;
  taskId?: number | null;
}, executor: Pick<typeof db, "insert"> = db) {
  await executor.insert(activities).values({
    projectId: input.projectId,
    actorId: input.actorId,
    action: input.action,
    detail: input.detail,
    taskId: input.taskId ?? null,
  });
}
