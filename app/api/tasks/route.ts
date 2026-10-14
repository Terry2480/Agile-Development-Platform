import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  tasks, users, teams, teamMembers, projects, sprints, labels, taskLabels, comments, attachments, taskCollaborators,
} from "@/db/schema";
import { requireUser, parseBody, requireProjectAccess, ApiError, handleApiError, displayName, taskCode } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { participatesInTask, syncCollaborators } from "@/lib/task-collaborators";

// 任务接口：GET /api/tasks?projectId=&status=&priority=&assigneeId=&sprintId=&mine=1&q=&labelId=&limit=
//           POST /api/tasks  新建（编号在事务内按项目递增分配，如 AGI-001）
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const projectIdParam = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const assigneeId = url.searchParams.get("assigneeId");
    const sprintId = url.searchParams.get("sprintId");
    const labelId = url.searchParams.get("labelId");
    const mine = url.searchParams.get("mine") === "1";
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500);

    // 可见范围：指定项目（校验访问）或我所在团队的全部项目
    let scopeProjectIds: number[];
    if (projectIdParam) {
      const projectId = Number(projectIdParam);
      await requireProjectAccess(user.id, projectId);
      scopeProjectIds = [projectId];
    } else {
      const myTeamIds = (
        await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, user.id))
      ).map((r) => r.teamId);
      if (myTeamIds.length === 0) return Response.json({ tasks: [] });
      const myProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.teamId, myTeamIds));
      scopeProjectIds = myProjects.map((p) => p.id);
      if (scopeProjectIds.length === 0) return Response.json({ tasks: [] });
    }

    // 组装过滤条件
    const conditions = [inArray(tasks.projectId, scopeProjectIds)];
    if (status) conditions.push(eq(tasks.status, status));
    if (priority) conditions.push(eq(tasks.priority, priority));
    if (assigneeId) conditions.push(eq(tasks.assigneeId, Number(assigneeId)));
    if (sprintId) conditions.push(eq(tasks.sprintId, Number(sprintId)));
    if (mine) conditions.push(participatesInTask(user.id));
    if (q) conditions.push(sql`${tasks.title} ILIKE ${"%" + q + "%"}`);

    if (labelId) {
      const labeled = await db
        .select({ taskId: taskLabels.taskId })
        .from(taskLabels)
        .where(eq(taskLabels.labelId, Number(labelId)));
      const labeledIds = [...new Set(labeled.map((l) => l.taskId))];
      if (labeledIds.length === 0) return Response.json({ tasks: [] });
      conditions.push(inArray(tasks.id, labeledIds));
    }

    const rows = await db
      .select({
        task: tasks,
        projectKey: projects.key,
        projectName: projects.name,
        assigneeName: users.name,
        assigneeStudentId: users.studentId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(limit);

    const taskIds = rows.map((r) => r.task.id);
    const collaboratorRows = taskIds.length ? await db.select({ taskId: taskCollaborators.taskId, userId: users.id, name: users.name, studentId: users.studentId })
      .from(taskCollaborators).innerJoin(users, eq(users.id, taskCollaborators.userId))
      .where(inArray(taskCollaborators.taskId, taskIds)).orderBy(users.id) : [];

    // 标签 / 评论数 / 附件数批量补齐
    const labelRows = taskIds.length
      ? await db
          .select({ taskId: taskLabels.taskId, id: labels.id, name: labels.name, color: labels.color })
          .from(taskLabels)
          .innerJoin(labels, eq(labels.id, taskLabels.labelId))
          .where(inArray(taskLabels.taskId, taskIds))
      : [];
    const commentCounts = taskIds.length
      ? await db
          .select({ taskId: comments.taskId, count: sql<number>`count(*)::int` })
          .from(comments)
          .where(inArray(comments.taskId, taskIds))
          .groupBy(comments.taskId)
      : [];
    const fileCounts = taskIds.length
      ? await db
          .select({ taskId: attachments.taskId, count: sql<number>`count(*)::int` })
          .from(attachments)
          .where(inArray(attachments.taskId, taskIds))
          .groupBy(attachments.taskId)
      : [];

    const result = rows.map((r) => ({
      ...r.task,
      code: taskCode(r.projectKey, r.task.number),
      projectName: r.projectName,
      collaborators: collaboratorRows.filter((c) => c.taskId === r.task.id).map((c) => ({ id: c.userId, displayName: displayName(c) })),
      assignee: r.task.assigneeId === null || r.assigneeStudentId === null ? null : {
        id: r.task.assigneeId,
        name: r.assigneeName,
        studentId: r.assigneeStudentId,
        displayName: displayName({ name: r.assigneeName, studentId: r.assigneeStudentId! }),
      },
      labels: labelRows.filter((l) => l.taskId === r.task.id).map(({ id, name, color }) => ({ id, name, color })),
      commentCount: commentCounts.find((c) => c.taskId === r.task.id)?.count ?? 0,
      attachmentCount: fileCounts.find((f) => f.taskId === r.task.id)?.count ?? 0,
    }));
    return Response.json({ tasks: result });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  projectId: z.number({ message: "请选择项目" }).int().positive("请选择项目"),
  title: z.string().trim().min(1, "请填写任务标题").max(200, "任务标题过长"),
  description: z.string().trim().max(2000, "描述过长").optional().nullable(),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assigneeId: z.number().int().positive().optional().nullable(),
  collaboratorIds: z.array(z.number().int().positive()).max(100).optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "截止日期格式应为 YYYY-MM-DD").optional().nullable(),
  sprintId: z.number().int().positive().optional().nullable(),
  parentTaskId: z.number().int().positive().optional().nullable(),
  labelIds: z.array(z.number().int().positive()).max(10).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);
    const { project } = await requireProjectAccess(user.id, body.projectId);

    // 事务内分配项目内递增编号，避免并发冲突
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      await requireProjectAccess(user.id, project.id, "member", tx);
    // 校验可选关联
    if (body.sprintId) {
      const [sprint] = await tx.select().from(sprints).where(eq(sprints.id, body.sprintId)).limit(1);
      if (!sprint || sprint.projectId !== body.projectId) throw new ApiError(400, "迭代不属于该项目");
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
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, body.parentTaskId)).limit(1);
      if (!parent || parent.projectId !== body.projectId) throw new ApiError(400, "父任务不存在");
    }

      if (body.labelIds?.length) {
        const ids = [...new Set(body.labelIds)];
        const valid = await tx.select({ id: labels.id }).from(labels).where(and(eq(labels.teamId, project.teamId), inArray(labels.id, ids)));
        if (valid.length !== ids.length) throw new ApiError(400, "标签不属于该团队");
      }

      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${tasks.number}), 0)::int` })
        .from(tasks)
        .where(eq(tasks.projectId, body.projectId));
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: body.projectId,
          sprintId: body.sprintId ?? null,
          number: max + 1,
          title: body.title,
          description: body.description || null,
          status: body.status,
          priority: body.priority,
          assigneeId: body.assigneeId ?? null,
          createdById: user.id,
          dueOn: body.dueOn ?? null,
          parentTaskId: body.parentTaskId ?? null,
        })
        .returning();
      if (body.labelIds?.length) {
        await tx
          .insert(taskLabels)
          .values(body.labelIds.map((labelId) => ({ taskId: task.id, labelId })))
          .onConflictDoNothing();
      }
      const created = task;
    const code = taskCode(project.key, created.number);
    await logActivity({
      projectId: body.projectId,
      taskId: created.id,
      actorId: user.id,
      action: "task.created",
      detail: `${displayName(user)} 创建了任务 ${code} ${created.title}`,
    }, tx);
    await syncCollaborators(tx, { taskId: created.id, teamId: project.teamId,
      assigneeId: created.assigneeId, collaboratorIds: body.collaboratorIds ?? [], actorId: user.id, code });

      return { ...created, code };
    });
    return Response.json({ task: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
