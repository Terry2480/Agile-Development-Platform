import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, chatMessages, users } from "@/db/schema";
import { requireUser, parseId, requireProjectAccess, ApiError, handleApiError, displayName } from "@/lib/api";

// 团队聊天记录搜索：GET /api/projects/[id]/chat/search?q=&type=&authorId=
// type: all（原文/文件名/作者名综合）/ text（仅原文）/ link（含 http(s) 链接的消息）/ file（文件消息）/ author（按人名）
// 返回新→旧最多 50 条；文件消息含 attachment（撤回的文件该字段为 null，content 仍是文件名）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const type = url.searchParams.get("type") ?? "all";
    if (!["all", "text", "link", "file", "author"].includes(type)) throw new ApiError(400, "搜索类型不合法");
    const authorIdRaw = url.searchParams.get("authorId");
    const authorId = authorIdRaw ? Number(authorIdRaw) : null;
    if (type === "author" && (!Number.isInteger(authorId) || authorId! <= 0)) {
      throw new ApiError(400, "请选择要查找的成员");
    }
    if (!q && type !== "link" && type !== "file" && type !== "author") {
      return Response.json({ hits: [] });
    }

    const conds = [eq(chatMessages.projectId, projectId), eq(chatMessages.recalled, false)];
    if (type === "link") conds.push(sql`(${chatMessages.content} ~* 'https?://')`);
    if (type === "file") conds.push(isNotNull(chatMessages.attachmentId));
    if (type === "author" && authorId) conds.push(eq(chatMessages.authorId, authorId));
    if (q) {
      const pattern = `%${q}%`;
      if (type === "file") conds.push(ilike(attachments.originalName, pattern));
      else if (type === "text" || type === "author") conds.push(ilike(chatMessages.content, pattern));
      else {
        const qCond = or(
          ilike(chatMessages.content, pattern),
          ilike(attachments.originalName, pattern),
          ilike(users.name, pattern),
          ilike(users.studentId, pattern),
        );
        if (qCond) conds.push(qCond);
      }
    }

    const rows = await db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        authorId: chatMessages.authorId,
        authorName: users.name,
        authorStudentId: users.studentId,
        attachmentId: attachments.id,
        attachmentName: attachments.originalName,
        attachmentSize: attachments.size,
      })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorId))
      .leftJoin(attachments, eq(attachments.id, chatMessages.attachmentId))
      .where(and(...conds))
      .orderBy(desc(chatMessages.id))
      .limit(50);

    return Response.json({
      hits: rows.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        author: { id: r.authorId, displayName: displayName({ name: r.authorName, studentId: r.authorStudentId }) },
        attachment: r.attachmentId ? { id: r.attachmentId, name: r.attachmentName ?? r.content, size: r.attachmentSize ?? 0 } : null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
