import { z } from "zod";
import { db } from "@/db";
import { createMilestone, createProject, getProjectForUser } from "@/lib/project";
import { createTask, listProjectTasks, updateTask } from "@/lib/task";
import { notifyTaskAssigned, notifyTaskCompleted } from "@/lib/notify";
import { ForbiddenError } from "@/lib/errors";
import type { WriteToolName } from "./tools";

const taskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const decomposeSchema = z.object({ tasks: z.array(taskDraftSchema).min(1) });

const patchSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

const updateTasksSchema = z.object({
  updates: z
    .array(z.object({ taskId: z.string(), updatedAt: z.string(), patch: patchSchema }))
    .min(1),
});

const planSprintSchema = z.object({
  milestoneId: z.string(),
  taskIds: z.array(z.string()).min(1),
  dueDate: z.string(),
});

const createMilestoneSchema = z.object({
  title: z.string().min(1),
  targetDate: z.string().optional(),
});

export type CommitResult = { committed: number; conflicts: string[] };

// 落库：绝不信 Agent 输出——入口重校访问权，每类先施 Zod，再走图二 lib（lib 内建权限/归属校验）
export async function commitDraft(
  actorId: string,
  projectId: string,
  tool: WriteToolName,
  draft: unknown,
): Promise<CommitResult> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  switch (tool) {
    case "create_project": {
      const d = createProjectSchema.parse(draft);
      await createProject(actorId, access.project.teamId, d);
      return { committed: 1, conflicts: [] };
    }
    case "decompose_tasks": {
      const d = decomposeSchema.parse(draft);
      // 批量落库裹事务：中途任一项抛错则整批回滚，杜绝半落库后重试致重复
      const created = await db.transaction(async (tx) => {
        const out: Awaited<ReturnType<typeof createTask>>[] = [];
        for (const t of d.tasks) out.push(await createTask(actorId, projectId, t, { tx }));
        return out;
      });
      // 事务提交后补发通知（tx 路径 createTask 不 fire，由此处统一发）
      for (const t of created) if (t.assigneeId) void notifyTaskAssigned(t);
      return { committed: d.tasks.length, conflicts: [] };
    }
    case "update_tasks": {
      const d = updateTasksSchema.parse(draft);
      const current = await listProjectTasks(actorId, projectId);
      const versionOf = new Map(current.map((r) => [r.id, r.updatedAt.toISOString()]));
      const prevStatus = new Map(current.map((r) => [r.id, r.status]));
      const conflicts: string[] = [];
      // 先剔除版本冲突项，余者裹事务批量应用（整批回滚保证一致）
      const toApply = d.updates.filter((u) => {
        if (versionOf.get(u.taskId) !== u.updatedAt) {
          conflicts.push(u.taskId);
          return false;
        }
        return true;
      });
      const updatedRows = await db.transaction(async (tx) => {
        const out: Awaited<ReturnType<typeof updateTask>>[] = [];
        for (const u of toApply) out.push(await updateTask(actorId, u.taskId, u.patch, { tx }));
        return out;
      });
      // 事务提交后补发完成通知：状态由非 done 转 done 者，知会创建者
      for (const t of updatedRows) {
        if (t.status === "done" && prevStatus.get(t.id) !== "done")
          void notifyTaskCompleted(t, actorId);
      }
      return { committed: updatedRows.length, conflicts };
    }
    case "plan_sprint": {
      const d = planSprintSchema.parse(draft);
      await db.transaction(async (tx) => {
        for (const id of d.taskIds)
          await updateTask(actorId, id, { milestoneId: d.milestoneId, dueDate: d.dueDate }, { tx });
      });
      return { committed: d.taskIds.length, conflicts: [] };
    }
    case "create_milestone": {
      const d = createMilestoneSchema.parse(draft);
      // createMilestone 内部以 role === "admin" 收口，非管理员在此被拒
      await createMilestone(actorId, projectId, d);
      return { committed: 1, conflicts: [] };
    }
  }
}
