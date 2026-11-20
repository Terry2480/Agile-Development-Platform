import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations, dmMessages } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError } from "@/lib/api";

// 标记私聊已读：把对方发来的未读消息全部置为已读（幂等）
// PUT /api/dm/[id]/read → { updated: 本次标记的条数 }
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");

    const [conversation] = await db
      .select()
      .from(dmConversations)
      .where(eq(dmConversations.id, conversationId))
      .limit(1);
    if (!conversation) throw new ApiError(404, "会话不存在");
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ApiError(403, "无权访问该会话");
    }

    const updated = await db
      .update(dmMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(dmMessages.conversationId, conversationId),
        ne(dmMessages.senderId, user.id),
        isNull(dmMessages.readAt),
      ))
      .returning({ id: dmMessages.id });

    return Response.json({ updated: updated.length });
  } catch (error) {
    return handleApiError(error);
  }
}
