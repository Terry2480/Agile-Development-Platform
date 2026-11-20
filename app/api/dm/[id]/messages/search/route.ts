import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { dmAttachments, dmConversations, dmMessages, users } from "@/db/schema";
import { requireUser, parseId, ApiError, handleApiError, displayName } from "@/lib/api";

// 私聊记录搜索：GET /api/dm/[id]/messages/search?q=&type=&authorId=
// type: all（原文/文件名综合）/ text（仅原文）/ link（含 http(s) 链接的消息）/ file（文件消息）/ author（按人名，仅会话双方）
// 返回新→旧最多 50 条，消息结构与 /api/dm/[id]/messages 一致（可直接复用渲染）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const type = url.searchParams.get("type") ?? "all";
    if (!["all", "text", "link", "file", "author"].includes(type)) throw new ApiError(400, "搜索类型不合法");
    const authorIdRaw = url.searchParams.get("authorId");
    const authorId = authorIdRaw ? Number(authorIdRaw) : null;
    if (type === "author") {
      if (!Number.isInteger(authorId) || authorId! <= 0) throw new ApiError(400, "请选择要查找的成员");
      if (authorId !== conversation.userAId && authorId !== conversation.userBId) {
        throw new ApiError(400, "只能查找会话双方的消息");
      }
    }
    if (!q && type !== "link" && type !== "file" && type !== "author") {
      return Response.json({ hits: [] });
    }

    const conds = [eq(dmMessages.conversationId, conversationId), eq(dmMessages.recalled, false)];
    if (type === "link") conds.push(sql`(${dmMessages.content} ~* 'https?://')`);
    if (type === "file") conds.push(isNotNull(dmMessages.attachmentId));
    if (type === "author" && authorId) conds.push(eq(dmMessages.senderId, authorId));
    if (q) {
      const pattern = `%${q}%`;
      if (type === "file") conds.push(ilike(dmAttachments.originalName, pattern));
      else if (type === "text" || type === "author") conds.push(ilike(dmMessages.content, pattern));
      else {
        const qCond = or(
          ilike(dmMessages.content, pattern),
          ilike(dmAttachments.originalName, pattern),
          ilike(users.name, pattern),
          ilike(users.studentId, pattern),
        );
        if (qCond) conds.push(qCond);
      }
    }

    const rows = await db
      .select({
        id: dmMessages.id,
        conversationId: dmMessages.conversationId,
        senderId: dmMessages.senderId,
        content: dmMessages.content,
        attachmentId: dmMessages.attachmentId,
        attName: dmAttachments.originalName,
        attSize: dmAttachments.size,
        attMime: dmAttachments.mimeType,
        readAt: dmMessages.readAt,
        createdAt: dmMessages.createdAt,
        senderName: users.name,
        senderStudentId: users.studentId,
      })
      .from(dmMessages)
      .innerJoin(users, eq(users.id, dmMessages.senderId))
      .leftJoin(dmAttachments, eq(dmAttachments.id, dmMessages.attachmentId))
      .where(and(...conds))
      .orderBy(desc(dmMessages.id))
      .limit(50);

    return Response.json({
      hits: rows.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: displayName({ name: m.senderName, studentId: m.senderStudentId }),
        mine: m.senderId === user.id,
        content: m.content,
        attachment: m.attachmentId ? { id: m.attachmentId, name: m.attName ?? m.content, size: m.attSize ?? 0, mimeType: m.attMime } : null,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
