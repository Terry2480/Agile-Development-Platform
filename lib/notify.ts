import { db } from "@/db";
import { notifications } from "@/db/schema";

/* 站内通知：被指派 / 被@提及 / 我的任务有新评论 */

// 发一条通知（不通知操作者本人）
export async function notify(input: {
  userId: number;
  actorId: number;
  type: "assigned" | "mention" | "comment";
  title: string;
  entityType?: "task" | "project";
  entityId?: number;
}, executor: Pick<typeof db, "insert"> = db) {
  if (input.userId === input.actorId) return; // 自己操作不给自己发通知
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
  entityType?: "task" | "project";
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
