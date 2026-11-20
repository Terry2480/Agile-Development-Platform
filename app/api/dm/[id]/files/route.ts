import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dmAttachments, dmConversations, dmMessages } from "@/db/schema";
import { uploadPath } from "@/lib/file-cleanup";
import { requireUser, parseId, ApiError, handleApiError, displayName } from "@/lib/api";
import { notifyDirectMessage } from "@/lib/notify";
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE } from "@/lib/upload-limits";

// 私聊文件：POST /api/dm/[id]/files  multipart { file }  发送文件消息（≤100MB，存 uploads/）
// 与团队聊天对齐（无置顶/@能力）；文件消息的正文即原始文件名，界面渲染为文件卡片
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let pendingStoredName: string | null = null;
  try {
    const user = await requireUser(request);
    const conversationId = parseId((await params).id, "会话 ID");

    const [conversation] = await db.select().from(dmConversations).where(eq(dmConversations.id, conversationId)).limit(1);
    if (!conversation) throw new ApiError(404, "会话不存在");
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ApiError(403, "无权访问该会话");
    }
    const partnerId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId;

    const form = await request.formData().catch((error: unknown) => {
      console.error("[dm-upload] 表单解析失败", error);
      throw new ApiError(400, "上传内容无法解析，可能未完整传输，请重新上传（文件不能超过 100MB）");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "请选择要上传的文件");
    if (file.size === 0) throw new ApiError(400, "文件为空");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, UPLOAD_LIMIT_MESSAGE);

    // 存储名 = 随机 UUID + 受控后缀（与项目文件一致，防路径穿越与重名）
    const ext = path.extname(file.name).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, "");
    const storedName = `${randomUUID()}${ext}`;
    pendingStoredName = storedName;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(uploadPath(storedName), Buffer.from(await file.arrayBuffer()), { flag: "wx" });

    const [attachment] = await db
      .insert(dmAttachments)
      .values({
        conversationId,
        uploaderId: user.id,
        originalName: file.name.slice(0, 200),
        storedName,
        mimeType: file.type || null,
        size: file.size,
      })
      .returning();

    const [message] = await db
      .insert(dmMessages)
      .values({ conversationId, senderId: user.id, content: attachment.originalName, attachmentId: attachment.id })
      .returning();
    await db
      .update(dmConversations)
      .set({
        lastMessageAt: message.createdAt,
        ...(conversation.userAId === user.id ? { hiddenForB: false } : { hiddenForA: false }),
      })
      .where(eq(dmConversations.id, conversationId));

    await notifyDirectMessage({
      conversationId,
      recipientId: partnerId,
      actorId: user.id,
      actorName: displayName(user),
    });

    pendingStoredName = null;
    return Response.json({
      message: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: displayName(user),
        mine: true,
        content: message.content,
        recalled: message.recalled,
        replyTo: null,
        attachment: { id: attachment.id, name: attachment.originalName, size: attachment.size, mimeType: attachment.mimeType },
        readAt: message.readAt,
        createdAt: message.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    // 数据库登记失败时尽力清理已写入的物理文件
    if (pendingStoredName) await unlink(uploadPath(pendingStoredName)).catch(() => {});
    return handleApiError(error);
  }
}
