import { and, eq } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { db } from "@/db";
import { dmAttachments, dmConversations, notifications } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError } from "@/lib/api";
import { uploadPath } from "@/lib/file-cleanup";

// 删除会话：清空双方的全部消息并移除会话（级联删除消息）；顺带清理关联的私信通知
// DELETE /api/dm/[id] → { ok: true }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      .delete(notifications)
      .where(and(eq(notifications.entityType, "dm"), eq(notifications.entityId, conversationId)));
    // 会话删除后物理文件不再被引用，尽力清理磁盘（失败不影响删除结果）
    const files = await db
      .select({ storedName: dmAttachments.storedName })
      .from(dmAttachments)
      .where(eq(dmAttachments.conversationId, conversationId));
    await db.delete(dmConversations).where(eq(dmConversations.id, conversationId));
    for (const f of files) {
      await unlink(uploadPath(f.storedName)).catch(() => {});
    }
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
