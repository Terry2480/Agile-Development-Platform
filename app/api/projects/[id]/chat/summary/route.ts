import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, chatMessages, users } from "@/db/schema";
import { requireUser, parseId, requireProjectAccess, handleApiError, displayName } from "@/lib/api";
import { summarizeChat } from "@/lib/chat-summary";

// 频道消息摘要：GET /api/projects/[id]/chat/summary?date=YYYY-MM-DD（默认今天，Asia/Hong_Kong）
// 规则式归纳当日要点：消息量/参与人/提及任务/文件/链接/待跟进问题
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const dateParam = new URL(request.url).searchParams.get("date");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "")
      ? dateParam!
      : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

    const rows = await db
      .select({
        content: chatMessages.content,
        recalled: chatMessages.recalled,
        attachmentName: attachments.originalName,
        authorName: users.name,
        authorStudentId: users.studentId,
      })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorId))
      .leftJoin(attachments, eq(attachments.id, chatMessages.attachmentId))
      .where(and(
        eq(chatMessages.projectId, projectId),
        eq(chatMessages.recalled, false),
        gte(chatMessages.createdAt, sql`(${date})::timestamptz`),
        lte(chatMessages.createdAt, sql`(${date}::date + 1)::timestamptz`),
      ))
      .orderBy(asc(chatMessages.id))
      .limit(1000);

    const summary = summarizeChat(rows.map((r) => ({
      authorName: displayName({ name: r.authorName, studentId: r.authorStudentId }),
      content: r.content,
      attachmentName: r.attachmentName ?? null,
    })));

    return Response.json({ date, summary });
  } catch (error) {
    return handleApiError(error);
  }
}
