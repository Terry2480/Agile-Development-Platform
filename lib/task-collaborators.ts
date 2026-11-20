import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, teamMembers, taskCollaborators } from "@/db/schema";
import { ApiError } from "./api";
import { notify } from "./notify";

export function participatesInTask(userId: number) {
  return or(eq(tasks.assigneeId, userId), sql`exists (
    select 1 from task_collaborators where task_collaborators.task_id = ${tasks.id}
    and task_collaborators.user_id = ${userId})`)!;
}

export async function syncCollaborators(tx: Pick<typeof db, "select" | "insert" | "delete">,
  input: { taskId: number; teamId: number; assigneeId: number | null; collaboratorIds: number[]; actorId: number; code: string }) {
  const ids = [...new Set([...input.collaboratorIds, ...(input.assigneeId ? [input.assigneeId] : [])])];
  if (ids.length) {
    const valid = await tx.select({ id: teamMembers.userId }).from(teamMembers)
      .where(and(eq(teamMembers.teamId, input.teamId), inArray(teamMembers.userId, ids)));
    if (valid.length !== ids.length) throw new ApiError(400, "协作成员必须属于该团队");
  }
  const before = await tx.select({ id: taskCollaborators.userId }).from(taskCollaborators).where(eq(taskCollaborators.taskId, input.taskId));
  await tx.delete(taskCollaborators).where(eq(taskCollaborators.taskId, input.taskId));
  if (ids.length) await tx.insert(taskCollaborators).values(ids.map((userId) => ({ taskId: input.taskId, userId })));
  for (const userId of ids.filter((id) => !before.some((row) => row.id === id))) {
    await notify({ userId, actorId: input.actorId, type: "assigned", includeActor: true,
      title: `你已加入任务 ${input.code}，请查看待办`, entityType: "task", entityId: input.taskId }, tx);
  }
  return ids;
}
