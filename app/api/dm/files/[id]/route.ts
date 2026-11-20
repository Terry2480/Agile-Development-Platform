import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmAttachments, dmConversations } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError } from "@/lib/api";
import { uploadPath } from "@/lib/file-cleanup";

// 私聊文件下载：GET /api/dm/files/[id]  校验会话双方身份后回传文件流（原始文件名展示）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const attachmentId = parseId((await params).id, "文件 ID");

    const [row] = await db
      .select({ attachment: dmAttachments, conversation: dmConversations })
      .from(dmAttachments)
      .innerJoin(dmConversations, eq(dmConversations.id, dmAttachments.conversationId))
      .where(eq(dmAttachments.id, attachmentId))
      .limit(1);
    if (!row) throw new ApiError(404, "文件不存在");
    const { attachment, conversation } = row;
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ApiError(403, "无权下载该文件");
    }

    const buffer = await readFile(uploadPath(attachment.storedName)).catch(() => {
      throw new ApiError(404, "文件已丢失");
    });

    const encodedName = encodeURIComponent(attachment.originalName);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
