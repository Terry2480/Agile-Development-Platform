import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { ForbiddenError, AppError } from "@/lib/errors";

// 每项目复用最近一条会话（MVP 简化：每项目一活跃会话）
export async function getOrCreateConversation(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({ projectId, createdById: actorId })
    .returning();
  return created;
}

export type ToolTraceEntry = { toolName: string; input: unknown; output: unknown };

export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
  toolTrace: ToolTraceEntry[],
) {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userText },
    {
      conversationId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolTrace.length > 0 ? toolTrace : null,
    },
  ]);
}

export async function listConversationMessages(actorId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conv) throw new AppError("会话不存在");
  const access = await getProjectForUser(actorId, conv.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}
