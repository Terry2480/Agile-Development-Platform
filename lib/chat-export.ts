// 聊天记录导出：把消息列表组装成 Markdown 文本。纯函数，便于单测。
// 消息结构对齐 /api/projects/[id]/chat 的 ChatMessage（lib/api-client.ts）。

export interface ExportChatMessage {
  id: number;
  content: string;
  createdAt: string;
  recalled: boolean;
  author: { displayName: string };
  attachment: { name: string; size: number } | null;
  task: { code: string; title: string } | null;
  replyTo: { authorName: string; content: string } | null;
}

/** ISO → 北京时间 "11-19 14:05"（与站内聊天时间口径一致：UTC+8） */
export function exportTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 组装 Markdown：按天分组，撤回消息保留占位，附件/任务/引用以引用行标注 */
export function buildChatMarkdown(projectName: string, messages: ExportChatMessage[]): string {
  const lines: string[] = [`# 聊天记录 · ${projectName}`, "", `- 导出时间：${exportTime(new Date().toISOString())}（北京时间）`, `- 消息条数：${messages.length}`, ""];
  let lastDay = "";
  for (const m of messages) {
    const day = exportTime(m.createdAt).slice(0, 5);
    if (day !== lastDay) {
      lines.push(`## ${day.replace("-", " 月 ")} 日`, "");
      lastDay = day;
    }
    if (m.recalled) {
      lines.push(`- \`${exportTime(m.createdAt)}\` ${m.author.displayName}：_（已撤回）_`);
      continue;
    }
    const head = `- \`${exportTime(m.createdAt)}\` **${m.author.displayName}**：`;
    if (m.replyTo) {
      lines.push(`${head}`, `  > 回复 ${m.replyTo.authorName}：${m.replyTo.content.split("\n")[0]}`);
    }
    for (const row of m.content.split("\n")) lines.push(m.replyTo ? `  ${row}` : (head + row).trimEnd());
    if (m.attachment) lines.push(`  - 📎 附件：${m.attachment.name}（${m.attachment.size} 字节）`);
    if (m.task) lines.push(`  - 🔗 关联任务：${m.task.code} ${m.task.title}`);
  }
  return lines.join("\n") + "\n";
}

/** 导出文件名：项目名里的路径敏感字符替换掉 */
export function exportFileName(projectName: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, "_").trim() || "聊天";
  return `聊天记录-${safe}-${exportTime(new Date().toISOString()).slice(0, 5).replace("-", "")}.md`;
}
