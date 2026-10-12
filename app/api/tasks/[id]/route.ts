import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  tasks, users, projects, sprints, labels, taskLabels, comments, attachments, activities, teamMembers, teams,
} from "@/db/schema";
import {
  requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError,
  displayName, taskCode, STATUS_LABEL, PRIORITY_LABEL,
} from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notify";

// 通过任务 id 取任务并校验访问；返回 { task, project }
async function requireTask(userId: number, taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new ApiError(404, "任务不存在");
  const { project } = await requireProjectAccess(userId, task.projectId);
  return { task, project };
}

// 任务详情：GET /api/tasks/[id]（含编号、负责人、标签、评论、子任务、附件、活动记录）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const taskId = parseId((await params).id, "任务 ID");
    const { task, project } = await requireTask(user.id, taskId);

    const [assignee] = task.assigneeId
      ? await db.select({ id: users.id, name: users.name, studentId: users.studentId }).from(users).where(eq(users.id, task.assigneeId)).limit(1)
      : [null];
    const [creator] = task.createdById
      ? await db.select({ id: users.id, name: users.name, studentId: users.studentId }).from(users).where(eq(users.id, task.createdById)).limit(1)
      : [null];
    const [sprint] = task.sprintId
      ? await db.select().from(sprints).where(eq(sprints.id, task.sprintId)).limit(1)
      : [null];

    const labelRows = await db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(eq(taskLabels.taskId, taskId));

    const commentRows = await db
      .select({
        id: comments.id, content: comments.content, createdAt: comments.createdAt,
        authorId: users.id, authorName: users.name, authorStudentId: users.studentId,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.taskId, taskId))
      .orderBy(comments.createdAt);

    const subtaskRows = await db.select().from(tasks).where(eq(tasks.parentTaskId, taskId)).orderBy(tasks.number);

    const fileRows = await db
      .select({
        id: attachments.id, originalName: attachments.originalName, size: attachments.size,
        mimeType: attachments.mimeType, createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.taskId, taskId))
      .orderBy(desc(attachments.createdAt));

    const activityRows = await db
      .select({
        id: activities.id, action: activities.action, detail: activities.detail, createdAt: activities.createdAt,
        actorName: users.name, actorStudentId: users.studentId,
      })
      .from(activities)
      .innerJoin(users, eq(users.id, activities.actorId))
      .where(eq(activities.taskId, taskId))
      .orderBy(desc(activities.createdAt))
      .limit(100);

    return Response.json({
      task: {
        ...task,
        code: taskCode(project.key, task.number),
        projectId: task.projectId,
        projectName: project.name,
        assignee: assignee ? { ...assignee, displayName: displayName(assignee) } : null,
        creator: creator ? { ...creator, displayName: displayName(creator) } : null,
        sprint: sprint ?? null,
        labels: labelRows,
        comments: commentRows.map((c) => ({ ...c, authorDisplayName: displayName({ name: c.authorName, studentId: c.authorStudentId }) })),
        subtasks: subtaskRows.map((s) => ({ ...s, code: taskCode(project.key, s.number) })),
        files: fileRows,
        activities: activityRows.map((a) => ({ ...a, actorDisplayName: displayName({ name: a.actorName, studentId: a.actorStudentId }) })),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  title: z.string().trim().min(1, "请填写任务标题").max(200).optional(),
  description: z.string().trim().max(2000, "描述过长").optional().nullable(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeId: z.number().int().positive().optional().nullable(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "截止日期格式应为 YYYY-MM-DD").optional().nullable(),
  sprintId: z.number().int().positive().optional().nullable(),
  parentTaskId: z.number().int().positive().optional().nullable(),
  labelIds: z.array(z.number().int().positive()).max(10).optional(),
});

// 更新任务：PUT /api/tasks/[id]  对状态 / 负责人 / 优先级 / 截止日的变更写项目日志并触发通知
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const taskId = parseId((await params).id, "任务 ID");
    const { project } = await requireTask(user.id, taskId);
    const body = await parseBody(request, updateSchema);

    const result = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      await requireProjectAccess(user.id, project.id, "member", tx);
      const [before] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
      if (!before) throw new ApiError(404, "任务不存在");
      if (body.labelIds?.length) {
        const ids = [...new Set(body.labelIds)];
        const valid = await tx.select({ id: labels.id }).from(labels).where(and(eq(labels.teamId, project.teamId), inArray(labels.id, ids)));
        if (valid.length !== ids.length) throw new ApiError(400, "标签不属于该团队");
      }
    // 关联校验
    if (body.sprintId) {
      const [sprint] = await tx.select().from(sprints).where(eq(sprints.id, body.sprintId)).limit(1);
      if (!sprint || sprint.projectId !== before.projectId) throw new ApiError(400, "迭代不属于该项目");
    }
    if (body.assigneeId) {
      const [member] = await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(and(eq(teams.id, project.teamId), eq(teamMembers.userId, body.assigneeId)))
        .limit(1);
      if (!member) throw new ApiError(400, "负责人不是该团队成员");
    }
    if (body.parentTaskId) {
      if (body.parentTaskId === taskId) throw new ApiError(400, "任务不能作为自己的父任务");
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, body.parentTaskId)).limit(1);
      if (!parent || parent.projectId !== before.projectId) throw new ApiError(400, "父任务不存在");
    }

    const [after] = await tx
      .update(tasks)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId ?? null } : {}),
        ...(body.dueOn !== undefined ? { dueOn: body.dueOn ?? null } : {}),
        ...(body.sprintId !== undefined ? { sprintId: body.sprintId ?? null } : {}),
        ...(body.parentTaskId !== undefined ? { parentTaskId: body.parentTaskId ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning();

    // 标签同步：全量替换
    if (body.labelIds) {
      await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
      if (body.labelIds.length > 0) {
        await tx
          .insert(taskLabels)
          .values(body.labelIds.map((labelId) => ({ taskId, labelId })))
          .onConflictDoNothing();
      }
    }

    // 变更对比 → 项目日志 + 通知
    const code = taskCode(project.key, after.number);
    const actor = displayName(user);
    const changes: string[] = [];
    if (body.status !== undefined && before.status !== after.status) {
      changes.push(`${actor} 将 ${code} 移至「${STATUS_LABEL[after.status]}」`);
      await logActivity({ projectId: project.id, taskId, actorId: user.id, action: "task.status_changed", detail: changes[changes.length - 1] }, tx);
    }
    if (body.assigneeId !== undefined && before.assigneeId !== after.assigneeId) {
      let target = "未分配";
      if (after.assigneeId) {
        const [u] = await tx.select({ name: users.name, studentId: users.studentId }).from(users).where(eq(users.id, after.assigneeId)).limit(1);
        if (u) target = displayName(u);
      }
      changes.push(`${actor} 将 ${code} 指派给 ${target}`);
      await logActivity({ projectId: project.id, taskId, actorId: user.id, action: "task.assigned", detail: changes[changes.length - 1] }, tx);
      if (after.assigneeId) {
        await notify({
          userId: after.assigneeId, actorId: user.id, type: "assigned",
          title: `${actor} 将任务 ${code} 指派给你`, entityType: "task", entityId: taskId,
        }, tx);
      }
    }
    if (body.priority !== undefined && before.priority !== after.priority) {
      changes.push(`${actor} 将 ${code} 优先级调整为「${PRIORITY_LABEL[after.priority]}」`);
      await logActivity({ projectId: project.id, taskId, actorId: user.id, action: "task.priority_changed", detail: changes[changes.length - 1] }, tx);
    }
    if (body.dueOn !== undefined && before.dueOn !== after.dueOn) {
      changes.push(`${actor} 将 ${code} 截止日期改为 ${after.dueOn ?? "无"}`);
      await logActivity({ projectId: project.id, taskId, actorId: user.id, action: "task.due_changed", detail: changes[changes.length - 1] }, tx);
    }
    if (body.title !== undefined && before.title !== after.title) {
      await logActivity({ projectId: project.id, taskId, actorId: user.id, action: "task.renamed", detail: `${actor} 修改了 ${code} 的标题` }, tx);
    }

      return { ...after, code };
    });
    return Response.json({ task: result });
  } catch (error) {
    return handleApiError(error);
  }
}

// 删除任务：级联删除子任务 / 评论 / 标签关联 / 附件记录
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const taskId = parseId((await params).id, "任务 ID");
    const { project } = await requireTask(user.id, taskId);
    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      await requireProjectAccess(user.id, project.id, "member", tx);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
      if (!task) throw new ApiError(404, "任务不存在");
      const code = taskCode(project.key, task.number);
      await tx.delete(tasks).where(eq(tasks.id, taskId));
      await logActivity({ projectId: project.id, actorId: user.id, action: "task.deleted",
        detail: `${displayName(user)} 删除了任务 ${code} ${task.title}` }, tx);
    });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
