import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations, dmSettings } from "@/db/schema";
import { requireUser, parseBody, parseId, ApiError, handleApiError } from "@/lib/api";

// 私聊个人设置：PUT /api/dm/[id]/settings  { pinned?: boolean, muted?: boolean }
// 置顶 → 会话排到列表最前（组内按活跃倒序）；免打扰 → 不计入未读角标总数。仅影响本人。
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");
    const body = await parseBody(request, z.object({
      pinned: z.boolean().optional(),
      muted: z.boolean().optional(),
    }));

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
      .insert(dmSettings)
      .values({
        userId: user.id,
        conversationId,
        pinned: body.pinned ?? false,
        muted: body.muted ?? false,
      })
      .onConflictDoUpdate({
        target: [dmSettings.userId, dmSettings.conversationId],
        set: {
          ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
          ...(body.muted !== undefined ? { muted: body.muted } : {}),
        },
      });

    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
