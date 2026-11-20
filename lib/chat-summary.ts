/* 频道消息一键摘要（纯函数）：按天规则式归纳「今日要点」——
   消息量/参与人/提及的任务编号/发送的文件/分享的链接/待跟进问题数。不依赖 AI。 */

export interface ChatSummaryItem {
  authorName: string;
  content: string;
  attachmentName: string | null;
}

export interface ChatSummary {
  messageCount: number;
  participants: string[];
  tasks: string[];
  files: string[];
  links: string[];
  openQuestions: number;
}

const TASK_CODE_PATTERN = /\b([A-Z][A-Z0-9]{1,5}-\d{1,4})\b/g;
const LINK_PATTERN = /https?:\/\/[^\s，。）)】\]]+/g;

export function summarizeChat(items: ChatSummaryItem[]): ChatSummary {
  const participants = new Set<string>();
  const tasks = new Set<string>();
  const files: string[] = [];
  const links = new Set<string>();
  let openQuestions = 0;

  for (const item of items) {
    participants.add(item.authorName);
    for (const match of item.content.matchAll(TASK_CODE_PATTERN)) tasks.add(match[1]);
    for (const match of item.content.matchAll(LINK_PATTERN)) links.add(match[0]);
    if (/[？?]\s*$/.test(item.content.trim())) openQuestions += 1;
    if (item.attachmentName) files.push(item.attachmentName);
  }

  return {
    messageCount: items.length,
    participants: [...participants],
    tasks: [...tasks],
    files,
    links: [...links],
    openQuestions,
  };
}
