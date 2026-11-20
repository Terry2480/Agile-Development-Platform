import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { attachments, chatMessages, chatLikes, users, tasks, projects, teamMembers } from "@/db/schema";
import {
  requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError, displayName, taskCode,
} from "@/lib/api";
import { notifyMentions } from "@/lib/notify";

// 项目聊天：GET /api/projects/[id]/chat?afterId=/beforeId=/pinned=1
//   不带参数取最新 50 条；afterId 增量拉取；beforeId 向前翻页（加载更早，供搜索跳转）；
//   pinned=1 返回全部公告（新→旧，公告列表用）
//           POST { content, replyToId?, taskId? }  发送（@提及触发通知）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const searchParams = new URL(request.url).searchParams;
    const afterId = searchParams.get("afterId") ? Number(searchParams.get("afterId")) : null;
    const beforeId = searchParams.get("beforeId") ? Number(searchParams.get("beforeId")) : null;

    let rows;
    if (searchParams.get("pinned") === "1") {
      rows = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.projectId, projectId), eq(chatMessages.pinned, true)))
        .orderBy(desc(chatMessages.id))
        .limit(50);
    } else if (Number.isInteger(afterId) && afterId! > 0) {
      rows = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.projectId, projectId), gt(chatMessages.id, afterId!)))
        .orderBy(asc(chatMessages.id))
        .limit(200);
    } else if (Number.isInteger(beforeId) && beforeId! > 0) {
      rows = (
        await db
          .select()
          .from(chatMessages)
          .where(and(eq(chatMessages.projectId, projectId), lt(chatMessages.id, beforeId!)))
          .orderBy(desc(chatMessages.id))
          .limit(50)
      ).reverse();
    } else {
      rows = (
        await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.projectId, projectId))
          .orderBy(desc(chatMessages.id))
          .limit(50)
      ).reverse();
    }

    return Response.json({ messages: await decorateMessages(rows, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

// 补齐消息的展示信息：作者、赞同数、是否已赞、回复目标、关联任务
async function decorateMessages(rows: (typeof chatMessages.$inferSelect)[], currentUserId: number) {
  if (rows.length === 0) return [];
  const ids = rows.map((m) => m.id);

  const likes = await db
    .select({ messageId: chatLikes.messageId, userId: chatLikes.userId, emoji: chatLikes.emoji })
    .from(chatLikes)
    .where(inArray(chatLikes.messageId, ids));

  const authorIds = [...new Set(rows.map((m) => m.authorId))];
  const authors = await db
    .select({ id: users.id, name: users.name, studentId: users.studentId })
    .from(users)
    .where(inArray(users.id, authorIds));

  const replyIds = [...new Set(rows.map((m) => m.replyToId).filter((v): v is number => v !== null))];
  const replyTargets = replyIds.length
    ? await db
        .select({ id: chatMessages.id, content: chatMessages.content, authorId: chatMessages.authorId })
        .from(chatMessages)
        .where(inArray(chatMessages.id, replyIds))
    : [];

  const taskIds = [...new Set(rows.map((m) => m.taskId).filter((v): v is number => v !== null))];
  const linkedTasks = taskIds.length
    ? await db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status, number: tasks.number, key: projects.key })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(inArray(tasks.id, taskIds))
    : [];

  const attIds = [...new Set(rows.map((m) => m.attachmentId).filter((v): v is number => v !== null))];
  const attRows = attIds.length
    ? await db
        .select({ id: attachments.id, name: attachments.originalName, size: attachments.size })
        .from(attachments)
        .where(inArray(attachments.id, attIds))
    : [];

  return rows.map((m) => {
    const author = authors.find((a) => a.id === m.authorId);
    const reply = replyTargets.find((r) => r.id === m.replyToId);
    const replyAuthor = reply ? authors.find((a) => a.id === reply.authorId) : null;
    const task = linkedTasks.find((t) => t.id === m.taskId);
    const att = m.attachmentId ? attRows.find((a) => a.id === m.attachmentId) : null;
    // 表情回应按 emoji 分组（含我是否已回应）
    const mine = likes.filter((l) => l.messageId === m.id && l.userId === currentUserId);
    const reactionEmojis = [...new Set(likes.filter((l) => l.messageId === m.id).map((l) => l.emoji))];
    return {
      id: m.id,
      content: m.content,
      pinned: m.pinned,
      recalled: m.recalled,
      taskId: m.taskId,
      replyToId: m.replyToId,
      createdAt: m.createdAt,
      author: {
        id: m.authorId,
        displayName: author ? displayName(author) : "未知成员",
      },
      reactions: m.recalled ? [] : reactionEmojis.map((emoji) => ({
        emoji,
        count: likes.filter((l) => l.messageId === m.id && l.emoji === emoji).length,
        mine: mine.some((l) => l.emoji === emoji),
      })),
      replyTo: reply
        ? {
            id: reply.id,
            content: reply.content.slice(0, 60),
            authorName: replyAuthor ? displayName(replyAuthor) : "未知成员",
          }
        : null,
      task: task ? { id: task.id, code: taskCode(task.key, task.number), title: task.title, status: task.status } : null,
      attachment: att ? { id: att.id, name: att.name, size: att.size } : null,
    };
  });
}

const sendSchema = z.object({
  content: z.string().trim().min(1, "请填写消息内容").max(2000, "消息内容过长"),
  replyToId: z.number().int().positive().optional().nullable(),
  taskId: z.number().int().positive().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId);
    const body = await parseBody(request, sendSchema);

    if (body.replyToId) {
      const [target] = await db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.id, body.replyToId), eq(chatMessages.projectId, projectId)))
        .limit(1);
      if (!target) throw new ApiError(400, "回复的消息不存在");
    }
    if (body.taskId) {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, body.taskId)).limit(1);
      if (!task || task.projectId !== projectId) throw new ApiError(400, "关联任务不存在");
    }

    const [message] = await db
      .insert(chatMessages)
      .values({
        projectId,
        authorId: user.id,
        content: body.content,
        replyToId: body.replyToId ?? null,
        taskId: body.taskId ?? null,
      })
      .returning();

    // @提及 → 站内通知
    const members = await db
      .select({ userId: users.id, name: users.name, studentId: users.studentId })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, project.teamId));
    await notifyMentions({
      content: body.content,
      actorId: user.id,
      members,
      title: `${displayName(user)} 在 ${project.name} 频道中提到了你`,
      entityType: "project",
      entityId: projectId,
    });

    const [decoratedMessage] = await decorateMessages([message], user.id);
    return Response.json({ message: decoratedMessage }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
