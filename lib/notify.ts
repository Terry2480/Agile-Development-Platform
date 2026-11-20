import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dmAttachments, dmMessages, notifications } from "@/db/schema";
import { dmNotificationTitle } from "./dm";

/* 站内通知：被指派 / 被@提及 / 我的任务有新评论 */

// 发一条通知；默认不通知操作者，任务协作分配可显式包含本人。
export async function notify(input: {
  userId: number;
  actorId: number;
  type: "assigned" | "mention" | "comment" | "dm";
  title: string;
  entityType?: "task" | "project" | "dm" | "doc";
  entityId?: number;
  includeActor?: boolean;
}, executor: Pick<typeof db, "insert"> = db) {
  if (input.userId === input.actorId && !input.includeActor) return;
  await executor.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  });
}

// 从文本中解析 @提及：匹配团队成员的「名称或学工号」，返回被提到的用户 id（去重）
// 语法：@ + 连续的非空白非标点串，如 "@徐小龙 看下这个"（文档见 docs/API.md）
const MENTION_PATTERN = /@([^\s@，。,.:;、！？!?()（）【】\[\]]+)/g;

export function extractMentionIds(
  content: string,
  members: { userId: number; name: string | null; studentId: string }[],
): number[] {
  const ids = new Set<number>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const token = match[1];
    const hit = members.find(
      (m) => token === (m.name ?? "") || token === m.studentId,
    );
    if (hit) ids.add(hit.userId);
  }
  return [...ids];
}

// 给文本中所有被 @ 的成员发通知
export async function notifyMentions(input: {
  content: string;
  actorId: number;
  members: { userId: number; name: string | null; studentId: string }[];
  title: string;
  entityType?: "task" | "project" | "doc";
  entityId?: number;
}, executor: Pick<typeof db, "insert"> = db) {
  const ids = extractMentionIds(input.content, input.members);
  await Promise.all(
    ids.map((userId) =>
      notify({
        userId,
        actorId: input.actorId,
        type: "mention",
        title: input.title,
        entityType: input.entityType,
        entityId: input.entityId,
      }, executor),
    ),
  );
}

// 私信通知（合并提醒）：同一会话同一接收人若已有「未读」私信通知，则更新其标题而不新建——
// 连发一长串私信只提醒一次。会话是一对一，未读通知必然对应唯一发件人，无需额外字段。
// 标题 = 人名+动作（dmNotificationTitle），多条时括注未读条数与本批文件名（按先后）。
export async function notifyDirectMessage(input: {
  conversationId: number;
  recipientId: number;
  actorId: number;
  actorName: string;
}, executor: Pick<typeof db, "select" | "insert" | "update"> = db) {
  if (input.recipientId === input.actorId) return;

  // 以会话内真实的未读消息为准（而非通知计数），读过的批次自动结束合并
  const unreads = await executor
    .select({ id: dmMessages.id, attachmentId: dmMessages.attachmentId })
    .from(dmMessages)
    .where(and(
      eq(dmMessages.conversationId, input.conversationId),
      eq(dmMessages.senderId, input.actorId),
      isNull(dmMessages.readAt),
    ))
    .orderBy(asc(dmMessages.id));
  const attachmentIds = [...new Set(unreads.map((m) => m.attachmentId).filter((v): v is number => v !== null))];
  const nameRows = attachmentIds.length
    ? await executor
        .select({ id: dmAttachments.id, name: dmAttachments.originalName })
        .from(dmAttachments)
        .where(inArray(dmAttachments.id, attachmentIds))
    : [];
  const fileNames = attachmentIds.map((id) => nameRows.find((r) => r.id === id)?.name ?? "未知文件");
  const title = dmNotificationTitle(input.actorName, unreads.length, fileNames);

  const [existing] = await executor
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.userId, input.recipientId),
      eq(notifications.type, "dm"),
      eq(notifications.entityId, input.conversationId),
      eq(notifications.read, false),
    ))
    .orderBy(asc(notifications.id))
    .limit(1);

  if (existing) {
    await executor.update(notifications).set({ title }).where(eq(notifications.id, existing.id));
  } else {
    await executor.insert(notifications).values({
      userId: input.recipientId,
      type: "dm",
      title,
      entityType: "dm",
      entityId: input.conversationId,
    });
  }
}
