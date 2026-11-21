// 文档 AI 要点提取（本地规则引擎，零外部依赖）：从 Markdown 内容提取结构化要点，
// 给答辩演示「接入 AI 分析文档」的落点。未来若接 LLM，可在同一接口后替换实现。
// 纯函数，便于单测。

export interface DocSummary {
  /** 章节结构（Markdown 标题行） */
  headings: string[];
  /** 要点条目：列表项 / 引用 / 首段，每条一行 */
  keyPoints: string[];
  /** 提到的任务引用（[[CODE]]） */
  taskRefs: string[];
  /** 外部链接（http/https） */
  links: string[];
  /** 预计阅读时长（分钟，按中文 400 字/分钟估算） */
  readingMinutes: number;
  /** 正文字符数（去除标记符号） */
  charCount: number;
}

const CJK_RE = /[\u4e00-\u9fff]/;

/** 去除 Markdown 标记，得到近似纯文本 */
function plainOf(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")            // 标题
    .replace(/^[-*+]\s*/, "")             // 无序列表
    .replace(/^\d+[.)]\s*/, "")           // 有序列表
    .replace(/^>\s*/, "")                 // 引用
    .replace(/\*\*([^*]+)\*\*/g, "$1")    // 粗体
    .replace(/`([^`]+)`/g, "$1")          // 行内代码
    .trim();
}

export function extractDocSummary(content: string): DocSummary {
  const rows = content.split(/\r?\n/);
  const headings: string[] = [];
  const keyPoints: string[] = [];
  const taskRefs = new Set<string>();
  const links = new Set<string>();

  let firstParagraphDone = false;
  let textOnly = "";

  for (const row of rows) {
    const trimmed = row.trim();
    const heading = /^#{1,6}\s+(.+)/.exec(trimmed);
    if (heading) {
      headings.push(plainOf(heading[1]).slice(0, 40));
      continue;
    }
    if (!trimmed) continue;

    // 任务引用 [[CODE]]
    for (const ref of trimmed.matchAll(/\[\[([A-Za-z0-9-]+)\]\]/g)) taskRefs.add(ref[1]);
    // 链接
    for (const link of trimmed.matchAll(/https?:\/\/[^\s）)】\]]+/g)) links.add(link[0]);

    const plain = plainOf(trimmed);
    textOnly += plain;

    // 列表项与引用是最有信息量的行
    if (/^([-*+]|\d+[.)])\s+/.test(trimmed) || trimmed.startsWith(">")) {
      if (plain && keyPoints.length < 8) keyPoints.push(plain.slice(0, 60));
      continue;
    }
    // 首段：没出现列表前的第一段正文
    if (!firstParagraphDone && plain && !trimmed.startsWith("#")) {
      keyPoints.unshift(plain.slice(0, 60));
      firstParagraphDone = true;
    }
  }

  const cjkChars = [...textOnly].filter((ch) => CJK_RE.test(ch)).length;
  const readingMinutes = Math.max(1, Math.round(cjkChars / 400));

  return {
    headings,
    keyPoints: keyPoints.slice(0, 8),
    taskRefs: [...taskRefs],
    links: [...links],
    readingMinutes,
    charCount: cjkChars,
  };
}

/** 组装成可直接展示的要点行 */
export function formatDocSummary(summary: DocSummary): string[] {
  const lines: string[] = [];
  lines.push(`预计阅读 ${summary.readingMinutes} 分钟 · 正文约 ${summary.charCount} 字`);
  if (summary.headings.length > 0) lines.push(`结构：${summary.headings.join(" / ")}`);
  for (const point of summary.keyPoints) lines.push(`· ${point}`);
  if (summary.taskRefs.length > 0) lines.push(`关联任务：${summary.taskRefs.join("、")}`);
  if (summary.links.length > 0) lines.push(`外部链接 ${summary.links.length} 个：${summary.links.slice(0, 3).join("，")}${summary.links.length > 3 ? "…" : ""}`);
  return lines;
}
