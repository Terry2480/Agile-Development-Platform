/* 极简 Markdown 渲染器：先整体 HTML 转义再做替换，输出天然免疫 XSS。
   支持课程协作文档的常用子集：标题（带锚点，供目录大纲定位）、粗体、斜体、行内代码、
   代码块、有序/无序/任务列表、引用、分隔线、http(s) 链接、换行，
   以及 [[任务编号]]（如 [[E2E-002]]）→ 可点击的任务引用卡片。 */

const TASK_REF_PATTERN = /\[\[([A-Z][A-Z0-9]{0,5}-\d{1,4})\]\]/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 行内元素：[[任务码]]卡片 → `代码` → **粗体** → *斜体* → [文字](http(s) 链接)；只允许 http/https 协议
function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(TASK_REF_PATTERN, '<button type="button" class="ws-doc-task" data-code="$1">$1</button>');
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

interface Block {
  kind: "p" | "h" | "code" | "quote" | "ul" | "ol" | "hr";
  level?: number;
  lines: string[];
  text?: string;
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length) blocks.push({ kind: "p", lines: buffer });
  };

  let paragraph: string[] = [];
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块：``` 开始，直到下一个 ``` 或结尾
    if (/^```/.test(line.trim())) {
      flushParagraph(paragraph); paragraph = [];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      if (i < lines.length) i++; // 跳过结束围栏
      blocks.push({ kind: "code", lines: code });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph); paragraph = [];
      blocks.push({ kind: "h", level: heading[1].length, lines: [heading[2]] });
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph(paragraph); paragraph = [];
      blocks.push({ kind: "hr", lines: [] });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paragraph); paragraph = [];
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph(paragraph); paragraph = [];
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: "ul", lines: items });
      continue;
    }

    const ordered = line.match(/^\s*\d+[.、]\s+(.*)$/);
    if (ordered) {
      flushParagraph(paragraph); paragraph = [];
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+[.、]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: "ol", lines: items });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(paragraph); paragraph = [];
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }
  flushParagraph(paragraph);
  return blocks;
}

export function renderMarkdown(source: string): string {
  const blocks = parseBlocks(source);
  let headingSeq = 0; // 标题序号：renderMarkdown 与 extractToc 保持一致，供目录锚点定位
  return blocks.map((block) => {
    switch (block.kind) {
      case "h": {
        const id = `doc-h-${headingSeq++}`;
        return `<h${block.level} id="${id}">${renderInline(block.lines[0])}</h${block.level}>`;
      }
      case "hr":
        return "<hr />";
      case "code":
        return `<pre><code>${escapeHtml(block.lines.join("\n"))}</code></pre>`;
      case "quote":
        return `<blockquote><p>${block.lines.map(renderInline).join("<br />")}</p></blockquote>`;
      case "ul":
        return `<ul>${block.lines.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
      case "ol":
        return `<ol>${block.lines.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
      default:
        return `<p>${block.lines.map(renderInline).join("<br />")}</p>`;
    }
  }).join("\n");
}

// 目录大纲：按标题出现顺序提取 { level, text, id }；id 与 renderMarkdown 生成的锚点一致。
// 代码围栏内的 # 不算标题（复用同一解析器，规则天然一致）。
export function extractToc(source: string): { level: number; text: string; id: string }[] {
  return parseBlocks(source)
    .filter((block) => block.kind === "h")
    .map((block, index) => ({ level: block.level ?? 1, text: block.lines[0], id: `doc-h-${index}` }));
}
