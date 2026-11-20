import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError } from "@/lib/api";

// 隐藏会话：仅从我的列表移除（消息保留）；对方发来新消息或我重新发起时自动恢复
// PUT /api/dm/[id]/hide → { ok: true }
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

    await db
      .update(dmConversations)
      .set(conversation.userAId === user.id ? { hiddenForA: true } : { hiddenForB: true })
      .where(eq(dmConversations.id, conversationId));
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
