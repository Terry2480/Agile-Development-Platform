import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, chatLikes } from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError } from "@/lib/api";

// 表情回应（飞书式）：POST /api/chat/[id]/like  { emoji? }（默认 👍，切换该表情）
// 同一条消息同一人可对多个表情各回应一次，再点同表情取消
export const REACTION_EMOJIS = ["👍", "🎉", "😂", "🙏", "💪", "❤️"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const messageId = parseId((await params).id, "消息 ID");
    const { emoji } = await parseBody(request, z.object({ emoji: z.string().default("👍") }));
    if (!REACTION_EMOJIS.includes(emoji)) throw new ApiError(400, "不支持的表情");

    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
    if (!message) throw new ApiError(404, "消息不存在");
    if (message.recalled) throw new ApiError(400, "消息已撤回，无法回应");
    await requireProjectAccess(user.id, message.projectId);

    const [existing] = await db
      .select({ id: chatLikes.id })
      .from(chatLikes)
      .where(and(eq(chatLikes.messageId, messageId), eq(chatLikes.userId, user.id), eq(chatLikes.emoji, emoji)))
      .limit(1);

    if (existing) {
      await db.delete(chatLikes).where(eq(chatLikes.id, existing.id));
      return Response.json({ reacted: false, emoji });
    }
    await db.insert(chatLikes).values({ messageId, userId: user.id, emoji }).onConflictDoNothing();
    return Response.json({ reacted: true, emoji });
  } catch (error) {
    return handleApiError(error);
  }
}
