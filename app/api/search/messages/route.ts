import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, dmConversations, dmMessages, projects, teamMembers, users } from "@/db/schema";
import { requireUser, handleApiError, displayName } from "@/lib/api";

// 全局消息搜索（命令面板「聊天」分组）：GET /api/search/messages?q=
// 同时搜「我所在团队的项目频道」与「我的私信」，各取新→旧 5 条；不含已撤回/已隐藏会话
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return Response.json({ projectHits: [], dmHits: [] });
    const pattern = `%${q}%`;

    // 项目频道：我所在团队的全部项目（借 team_members 关联限定可见范围）
    const projectRows = await db
      .select({
        id: chatMessages.id,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        projectId: projects.id,
        projectName: projects.name,
        authorName: users.name,
        authorStudentId: users.studentId,
      })
      .from(chatMessages)
      .innerJoin(projects, eq(projects.id, chatMessages.projectId))
      .innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, user.id)))
      .innerJoin(users, eq(users.id, chatMessages.authorId))
      .where(and(ilike(chatMessages.content, pattern), eq(chatMessages.recalled, false)))
      .orderBy(desc(chatMessages.id))
      .limit(5);

    // 私信：我参与的会话（含被隐藏的也能搜到，点开即恢复）；对方名取 partner
    const dmRows = await db
      .select({
        id: dmMessages.id,
        content: dmMessages.content,
        createdAt: dmMessages.createdAt,
        conversationId: dmConversations.id,
        userAId: dmConversations.userAId,
        userBId: dmConversations.userBId,
        senderId: dmMessages.senderId,
      })
      .from(dmMessages)
      .innerJoin(dmConversations, eq(dmConversations.id, dmMessages.conversationId))
      .where(and(
        ilike(dmMessages.content, pattern),
        eq(dmMessages.recalled, false),
        or(eq(dmConversations.userAId, user.id), eq(dmConversations.userBId, user.id)),
      ))
      .orderBy(desc(dmMessages.id))
      .limit(5);
    const partnerIds = [...new Set(dmRows.map((r) => (r.userAId === user.id ? r.userBId : r.userAId)))];
    const partnerRows = partnerIds.length
      ? await db.select({ id: users.id, name: users.name, studentId: users.studentId }).from(users).where(inArray(users.id, partnerIds))
      : [];

    return Response.json({
      projectHits: projectRows.map((r) => ({
        id: r.id,
        content: r.content.slice(0, 60),
        createdAt: r.createdAt,
        projectId: r.projectId,
        projectName: r.projectName,
        authorName: displayName({ name: r.authorName, studentId: r.authorStudentId }),
      })),
      dmHits: dmRows.map((r) => {
        const pid = r.userAId === user.id ? r.userBId : r.userAId;
        const partner = partnerRows.find((p) => p.id === pid);
        return {
          id: r.id,
          content: r.content.slice(0, 60),
          createdAt: r.createdAt,
          conversationId: r.conversationId,
          partnerName: partner ? displayName(partner) : "未知成员",
          mine: r.senderId === user.id,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
