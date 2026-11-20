import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError } from "@/lib/api";

// 置顶 / 取消置顶：PUT /api/chat/[id]/pin  { pinned: boolean }
// 仅团队 owner / admin 可操作；公告可多条（频道顶部展示最新一条，全部可在公告列表查看）
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const messageId = parseId((await params).id, "消息 ID");

    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
    if (!message) throw new ApiError(404, "消息不存在");
    await requireProjectAccess(user.id, message.projectId, "admin");
    if (message.recalled) throw new ApiError(400, "消息已撤回，无法置顶");

    const body = await parseBody(request, z.object({ pinned: z.boolean() }));
    await db.update(chatMessages).set({ pinned: body.pinned }).where(eq(chatMessages.id, messageId));

    return Response.json({ ok: true, pinned: body.pinned });
  } catch (error) {
    return handleApiError(error);
  }
}
