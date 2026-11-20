import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { requireUser, parseId, requireProjectAccess, ApiError, handleApiError } from "@/lib/api";

// 撤回频道消息：POST /api/chat/[id]/recall（仅发送者本人，发送后 2 分钟内）
// 撤回后正文清空、取消置顶，双方界面显示「xx 撤回了一条消息」
const RECALL_WINDOW_MS = 2 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const messageId = parseId((await params).id, "消息 ID");

    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
    if (!message) throw new ApiError(404, "消息不存在");
    await requireProjectAccess(user.id, message.projectId);
    if (message.authorId !== user.id) throw new ApiError(403, "只能撤回自己发送的消息");
    if (message.recalled) throw new ApiError(400, "消息已撤回");
    const createdAt = message.createdAt ? new Date(message.createdAt).getTime() : 0;
    if (Date.now() - createdAt > RECALL_WINDOW_MS) throw new ApiError(400, "发送超过 2 分钟的消息不能撤回");

    await db
      .update(chatMessages)
      .set({ recalled: true, content: "", pinned: false, attachmentId: null })
      .where(eq(chatMessages.id, messageId));
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
