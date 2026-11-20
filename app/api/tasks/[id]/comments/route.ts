import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, comments, users, teamMembers, teams, projects } from "@/db/schema";
import {
  requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError, displayName, taskCode,
} from "@/lib/api";
import { notify, notifyMentions } from "@/lib/notify";

// 任务评论：GET /api/tasks/[id]/comments  评论列表
//           POST                        { content }  发表（@提及与任务负责人会收到通知）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const taskId = parseId((await params).id, "任务 ID");
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) throw new ApiError(404, "任务不存在");
    await requireProjectAccess(user.id, task.projectId);

    const rows = await db
      .select({
        id: comments.id, content: comments.content, createdAt: comments.createdAt,
        authorId: users.id, authorName: users.name, authorStudentId: users.studentId,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.taskId, taskId))
      .orderBy(comments.createdAt);

    return Response.json({ comments: rows.map((c) => ({ ...c, authorDisplayName: displayName({ name: c.authorName, studentId: c.authorStudentId }) })) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const taskId = parseId((await params).id, "任务 ID");
    const [initialTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!initialTask) throw new ApiError(404, "任务不存在");
    const { project } = await requireProjectAccess(user.id, initialTask.projectId);

    const body = await parseBody(
      request,
      z.object({ content: z.string().trim().min(1, "请填写评论内容").max(2000, "评论内容过长") }),
    );

    const comment = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      await requireProjectAccess(user.id, project.id, "member", tx);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
      if (!task) throw new ApiError(404, "任务不存在");
    const [comment] = await tx
      .insert(comments)
      .values({ taskId, authorId: user.id, content: body.content })
      .returning();

    // 通知：任务负责人（不是自己时）+ 评论里被 @ 的成员
    const code = taskCode(project.key, task.number);
    const actor = displayName(user);
    if (task.assigneeId) {
      await notify({
        userId: task.assigneeId, actorId: user.id, type: "comment",
        title: `${actor} 评论了任务 ${code}`, entityType: "task", entityId: taskId,
      }, tx);
    }
    const members = await tx
      .select({ userId: users.id, name: users.name, studentId: users.studentId })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, project.teamId));
    await notifyMentions({
      content: body.content, actorId: user.id, members,
      title: `${actor} 在任务 ${code} 中提到了你`, entityType: "task", entityId: taskId,
    }, tx);

      return comment;
    });
    return Response.json({
      comment: {
        ...comment,
        authorId: user.id, authorName: user.name, authorStudentId: user.studentId,
        authorDisplayName: displayName(user),
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
