import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations, dmMessages } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError } from "@/lib/api";

// 撤回私信消息：POST /api/dm/[id]/messages/[messageId]/recall（仅发送者本人，2 分钟内）
const RECALL_WINDOW_MS = 2 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");
    const messageId = parseId((await params).messageId, "消息 ID");

    const [conversation] = await db.select().from(dmConversations).where(eq(dmConversations.id, conversationId)).limit(1);
    if (!conversation) throw new ApiError(404, "会话不存在");
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ApiError(403, "无权访问该会话");
    }

    const [message] = await db.select().from(dmMessages).where(eq(dmMessages.id, messageId)).limit(1);
    if (!message || message.conversationId !== conversationId) throw new ApiError(404, "消息不存在");
    if (message.senderId !== user.id) throw new ApiError(403, "只能撤回自己发送的消息");
    if (message.recalled) throw new ApiError(400, "消息已撤回");
    const createdAt = message.createdAt ? new Date(message.createdAt).getTime() : 0;
    if (Date.now() - createdAt > RECALL_WINDOW_MS) throw new ApiError(400, "发送超过 2 分钟的消息不能撤回");

    await db
      .update(dmMessages)
      .set({ recalled: true, content: "", attachmentId: null })
      .where(eq(dmMessages.id, messageId));
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
