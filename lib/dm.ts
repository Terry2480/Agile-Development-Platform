/* 私聊纯函数：配对顺序、会话预览、未读统计。不引数据库依赖，便于单测复用 */

// 一对用户的标准顺序（小 id 在前）：保证 (a,b) 与 (b,a) 永远命中同一条会话
export function dmPair(a: number, b: number): [number, number] {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error("用户 ID 必须是整数");
  if (a === b) throw new Error("不能和自己私聊");
  return a < b ? [a, b] : [b, a];
}

// 会话列表预览：截断消息内容，空会话给占位文案
export function dmPreview(content: string | null | undefined, limit = 60): string {
  if (!content) return "开始对话吧";
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

// 未读数：对方发来且尚未阅读（readAt 为空）的消息条数
export function countUnread(messages: { senderId: number; readAt: string | Date | null }[], myId: number): number {
  return messages.filter((m) => m.senderId !== myId && m.readAt === null).length;
}

// 私信通知标题（合并提醒）：同一批未读只保留一条通知。
// 大标题保持「人名+动作」；多条时括注未读条数与本批发送的文件（按先后顺序，最多列 5 个）。
export function dmNotificationTitle(actorName: string, unreadCount: number, fileNames: string[]): string {
  if (unreadCount <= 1 && fileNames.length === 1) return `${actorName} 给你发来文件《${fileNames[0]}》`;
  if (unreadCount <= 1) return `${actorName} 给你发来私信`;
  const parts = [`${unreadCount} 条未读`];
  if (fileNames.length > 0) {
    const shown = fileNames.slice(0, 5).join("、");
    parts.push(`文件：${shown}${fileNames.length > 5 ? ` 等 ${fileNames.length} 个文件` : ""}`);
  }
  return `${actorName} 给你发来私信（${parts.join("；")}）`;
}
