import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { dmAttachments, dmConversations, dmMessages, users } from "@/db/schema";
import { requireUser, parseBody, parseId, ApiError, handleApiError, displayName } from "@/lib/api";
import { notifyDirectMessage } from "@/lib/notify";

// 私聊消息：
// GET  /api/dm/[id]/messages?afterId=/beforeId=  → 最新 80 条；afterId 增量；beforeId 向前翻页（搜索跳转）
// POST /api/dm/[id]/messages { content, replyToId? } → 发送消息（支持引用回复）并通知对方

// 会话访问校验：必须是会话的两个人之一；返回会话与对方 id
async function requireConversation(userId: number, conversationId: number) {
  const [conversation] = await db
    .select()
    .from(dmConversations)
    .where(eq(dmConversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new ApiError(404, "会话不存在");
  if (conversation.userAId !== userId && conversation.userBId !== userId) {
    throw new ApiError(403, "无权访问该会话");
  }
  return {
    conversation,
    partnerId: conversation.userAId === userId ? conversation.userBId : conversation.userAId,
  };
}

// 把数据库行组装为前端消息结构（含引用目标与附件）
function decorateDmMessages(
  rows: {
    id: number; conversationId: number; senderId: number; content: string;
    replyToId: number | null; attachmentId: number | null; recalled: boolean;
    readAt: Date | null; createdAt: Date | null;
    senderName: string | null; senderStudentId: string;
  }[],
  attachments: { id: number; name: string; size: number; mimeType: string | null }[],
  replyTargets: { id: number; content: string; senderId: number }[],
  currentUserId: number,
) {
  return rows.map((m) => {
    const reply = m.replyToId ? replyTargets.find((r) => r.id === m.replyToId) : null;
    const att = m.attachmentId ? attachments.find((a) => a.id === m.attachmentId) : null;
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderName: displayName({ name: m.senderName, studentId: m.senderStudentId }),
      mine: m.senderId === currentUserId,
      content: m.content,
      recalled: m.recalled,
      replyTo: reply
        ? { id: reply.id, content: reply.content.slice(0, 60), mine: reply.senderId === currentUserId }
        : null,
      attachment: att ? { id: att.id, name: att.name, size: att.size, mimeType: att.mimeType } : null,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  });
}

async function loadDecorateContext(rows: typeof dmMessages.$inferSelect[], currentUserId: number) {
  const attIds = [...new Set(rows.map((m) => m.attachmentId).filter((v): v is number => v !== null))];
  const attachments = attIds.length
    ? await db.select({ id: dmAttachments.id, name: dmAttachments.originalName, size: dmAttachments.size, mimeType: dmAttachments.mimeType })
        .from(dmAttachments).where(inArray(dmAttachments.id, attIds))
    : [];
  const replyIds = [...new Set(rows.map((m) => m.replyToId).filter((v): v is number => v !== null))];
  const replyTargets = replyIds.length
    ? await db.select({ id: dmMessages.id, content: dmMessages.content, senderId: dmMessages.senderId })
        .from(dmMessages).where(inArray(dmMessages.id, replyIds))
    : [];
  const senderIds = [...new Set(rows.map((m) => m.senderId))];
  const senders = await db
    .select({ id: users.id, name: users.name, studentId: users.studentId })
    .from(users).where(inArray(users.id, senderIds));
  const decorated = rows.map((m) => {
    const s = senders.find((x) => x.id === m.senderId);
    return {
      id: m.id, conversationId: m.conversationId, senderId: m.senderId, content: m.content,
      replyToId: m.replyToId, attachmentId: m.attachmentId, recalled: m.recalled,
      readAt: m.readAt, createdAt: m.createdAt,
      senderName: s?.name ?? null, senderStudentId: s?.studentId ?? "",
    };
  });
  return decorateDmMessages(decorated, attachments, replyTargets, currentUserId);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");
    await requireConversation(user.id, conversationId);

    const searchParams = new URL(request.url).searchParams;
    const afterId = searchParams.get("afterId") ? Number(searchParams.get("afterId")) : null;
    const beforeId = searchParams.get("beforeId") ? Number(searchParams.get("beforeId")) : null;

    const baseSelect = db.select().from(dmMessages);
    let rows;
    if (Number.isInteger(afterId) && afterId! > 0) {
      rows = await baseSelect
        .where(and(eq(dmMessages.conversationId, conversationId), gt(dmMessages.id, afterId!)))
        .orderBy(asc(dmMessages.id))
        .limit(200);
    } else if (Number.isInteger(beforeId) && beforeId! > 0) {
      rows = (
        await db.select().from(dmMessages)
          .where(and(eq(dmMessages.conversationId, conversationId), lt(dmMessages.id, beforeId!)))
          .orderBy(desc(dmMessages.id))
          .limit(80)
      ).reverse();
    } else {
      rows = (
        await db.select().from(dmMessages)
          .where(eq(dmMessages.conversationId, conversationId))
          .orderBy(desc(dmMessages.id))
          .limit(80)
      ).reverse();
    }

    return Response.json({ messages: await loadDecorateContext(rows, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

const sendSchema = z.object({
  content: z.string().trim().min(1, "请填写消息内容").max(2000, "消息内容过长"),
  replyToId: z.number().int().positive().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");
    const { conversation, partnerId } = await requireConversation(user.id, conversationId);
    const body = await parseBody(request, sendSchema);

    if (body.replyToId) {
      const [target] = await db
        .select()
        .from(dmMessages)
        .where(and(eq(dmMessages.id, body.replyToId), eq(dmMessages.conversationId, conversationId)))
        .limit(1);
      if (!target) throw new ApiError(400, "回复的消息不存在");
    }

    const [message] = await db
      .insert(dmMessages)
      .values({
        conversationId,
        senderId: user.id,
        content: body.content,
        replyToId: body.replyToId ?? null,
      })
      .returning();
    // 更新最后活跃时间；若对方隐藏过该会话，新消息自动让其恢复显示
    await db
      .update(dmConversations)
      .set({
        lastMessageAt: message.createdAt,
        ...(conversation.userAId === user.id ? { hiddenForB: false } : { hiddenForA: false }),
      })
      .where(eq(dmConversations.id, conversationId));

    // 站内通知对方（合并提醒）：点击直达该会话（entityType=dm，entityId=会话 id）
    await notifyDirectMessage({
      conversationId,
      recipientId: partnerId,
      actorId: user.id,
      actorName: displayName(user),
    });

    const [decorated] = await loadDecorateContext([message], user.id);
    return Response.json({ message: decorated }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
