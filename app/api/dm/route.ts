import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { dmConversations, dmMessages, dmSettings, teamMembers, users } from "@/db/schema";
import { requireUser, parseBody, ApiError, handleApiError, displayName } from "@/lib/api";
import { memberOnline } from "@/lib/presence";
import { dmPair, dmPreview } from "@/lib/dm";

// 私聊会话列表 / 发起私聊：
// GET  /api/dm                → 我参与的会话（对方信息、最后消息、未读数、置顶/免打扰）
//        排序：我置顶的会话最前（组内按活跃倒序），其余按最近活跃倒序——最近对话的对象
//        自动位于置顶对象下的第一条；免打扰会话不计入 unreadTotal
// POST /api/dm { peerId }     → 与同团队成员打开（或创建）一对一会话

type ConversationRow = typeof dmConversations.$inferSelect;

// 组装会话展示数据：对方资料、最后一条消息、未读数（我方隐藏的会话不返回）
async function decorateConversations(rows: { conv: ConversationRow; pinned: boolean | null; muted: boolean | null }[], myId: number) {
  if (rows.length === 0) return { conversations: [], unreadTotal: 0 };
  const visibleRows = rows
    .filter((r) => (r.conv.userAId === myId ? !r.conv.hiddenForA : !r.conv.hiddenForB))
    .sort((a, b) => {
      const pinDiff = Number(b.pinned ?? false) - Number(a.pinned ?? false);
      if (pinDiff !== 0) return pinDiff;
      const av = new Date(a.conv.lastMessageAt ?? a.conv.createdAt ?? 0).getTime();
      const bv = new Date(b.conv.lastMessageAt ?? b.conv.createdAt ?? 0).getTime();
      return bv - av;
    });
  if (visibleRows.length === 0) return { conversations: [], unreadTotal: 0 };
  const ids = visibleRows.map((r) => r.conv.id);
  const partnerIds = [...new Set(visibleRows.map((r) => (r.conv.userAId === myId ? r.conv.userBId : r.conv.userAId)))];

  const partners = await db
    .select({ id: users.id, name: users.name, studentId: users.studentId, online: memberOnline(users.id) })
    .from(users)
    .where(inArray(users.id, partnerIds));

  const lastRows = await db
    .selectDistinctOn([dmMessages.conversationId], {
      conversationId: dmMessages.conversationId,
      content: dmMessages.content,
      senderId: dmMessages.senderId,
      createdAt: dmMessages.createdAt,
    })
    .from(dmMessages)
    .where(inArray(dmMessages.conversationId, ids))
    .orderBy(dmMessages.conversationId, desc(dmMessages.id));

  const unreadRows = await db
    .select({ conversationId: dmMessages.conversationId, count: sql<number>`count(*)::int` })
    .from(dmMessages)
    .where(and(inArray(dmMessages.conversationId, ids), ne(dmMessages.senderId, myId), isNull(dmMessages.readAt)))
    .groupBy(dmMessages.conversationId);

  const conversations = visibleRows.map((r) => {
    const c = r.conv;
    const partnerUser = partners.find((p) => p.id === c.userAId || p.id === c.userBId);
    const partner = partnerUser && partnerUser.id !== myId ? partnerUser : partners.find((p) => p.id !== myId);
    const last = lastRows.find((m) => m.conversationId === c.id) ?? null;
    return {
      id: c.id,
      partner: {
        userId: partner?.id ?? 0,
        displayName: partner ? displayName(partner) : "未知成员",
        online: partner?.online ?? false,
      },
      lastMessage: last
        ? { content: dmPreview(last.content), senderId: last.senderId, createdAt: last.createdAt }
        : null,
      unreadCount: unreadRows.find((u) => u.conversationId === c.id)?.count ?? 0,
      pinned: r.pinned ?? false,
      muted: r.muted ?? false,
    };
  });
  // 免打扰会话不计入未读总数（列表内仍显示灰色未读数）
  return { conversations, unreadTotal: conversations.filter((c) => !c.muted).reduce((sum, c) => sum + c.unreadCount, 0) };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await db
      .select({ conv: dmConversations, pinned: dmSettings.pinned, muted: dmSettings.muted })
      .from(dmConversations)
      .leftJoin(dmSettings, and(eq(dmSettings.conversationId, dmConversations.id), eq(dmSettings.userId, user.id)))
      .where(or(eq(dmConversations.userAId, user.id), eq(dmConversations.userBId, user.id)))
      .limit(200);
    return Response.json(await decorateConversations(rows, user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

const openSchema = z.object({
  peerId: z.number({ message: "请选择私聊对象" }).int().positive("请选择私聊对象"),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { peerId } = await parseBody(request, openSchema);
    if (peerId === user.id) throw new ApiError(400, "不能和自己私聊");

    const [peer] = await db
      .select({ id: users.id, name: users.name, studentId: users.studentId })
      .from(users)
      .where(eq(users.id, peerId))
      .limit(1);
    if (!peer) throw new ApiError(404, "对方不存在");

    // 仅同团队成员可私聊：防止陌生用户借平台打扰
    const [shared] = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(
        eq(teamMembers.userId, user.id),
        sql`exists (select 1 from team_members peer where peer.team_id = ${teamMembers.teamId} and peer.user_id = ${peerId})`,
      ))
      .limit(1);
    if (!shared) throw new ApiError(403, "只能与同团队的成员发起私聊");

    const [a, b] = dmPair(user.id, peerId);
    await db.insert(dmConversations).values({ userAId: a, userBId: b }).onConflictDoNothing();
    // 重新发起会话时自动取消我方的隐藏状态（隐藏过的会话恢复显示）
    await db
      .update(dmConversations)
      .set(a === user.id ? { hiddenForA: false } : { hiddenForB: false })
      .where(and(eq(dmConversations.userAId, a), eq(dmConversations.userBId, b)));
    const [conversation] = await db
      .select()
      .from(dmConversations)
      .where(and(eq(dmConversations.userAId, a), eq(dmConversations.userBId, b)))
      .limit(1);

    return Response.json({
      conversation: {
        id: conversation.id,
        partner: { userId: peer.id, displayName: displayName(peer), online: false },
        lastMessage: null,
        unreadCount: 0,
        pinned: false,
        muted: false,
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
