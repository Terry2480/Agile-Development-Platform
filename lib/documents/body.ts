import { z } from "zod";
export type BodyNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: BodyNode[] };
const types = new Set(["doc", "paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "codeBlock", "blockquote", "hardBreak", "markdown", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader", "image"]);
export const bodyInput = z.unknown().transform((value, ctx): BodyNode => {
  let count = 0;
  function check(v: unknown, depth: number): boolean {
    if (!v || typeof v !== "object" || Array.isArray(v) || depth > 30 || ++count > 50000) return false;
    const n = v as BodyNode;
    if (!types.has(n.type) || Object.keys(n).some(k => !["type", "text", "attrs", "marks", "content"].includes(k))) return false;
    if (n.type === "markdown") return depth === 1 && typeof n.text === "string" && n.content === undefined && n.attrs === undefined && n.marks === undefined;
    if (n.type === "text" && (typeof n.text !== "string" || n.content !== undefined)) return false;
    if (n.text !== undefined && n.type !== "text") return false;
    if (n.attrs !== undefined) {
      if (!n.attrs || typeof n.attrs !== "object" || Array.isArray(n.attrs)) return false;
      const allowed = n.type === "heading" ? ["level"] : n.type === "image" ? ["resourceId", "alt", "width", "height"] : n.type === "orderedList" ? ["start"] : n.type === "tableCell" || n.type === "tableHeader" ? ["colspan", "rowspan", "colwidth"] : [];
      if (Object.keys(n.attrs).some(k => !allowed.includes(k))) return false;
      if (n.type === "heading" && ![1,2,3,4,5,6].includes(Number(n.attrs.level))) return false;
      if (n.type === "image" && (!Number.isInteger(n.attrs.resourceId) || Number(n.attrs.resourceId) < 1 || (n.attrs.alt !== undefined && typeof n.attrs.alt !== "string"))) return false;
    }
    if (n.type === "image" && !n.attrs) return false;
    if (n.marks && (!Array.isArray(n.marks) || n.marks.some(m => !m || !["bold", "italic", "strike", "underline", "code", "link"].includes(m.type) || Object.keys(m).some(k => !["type", "attrs"].includes(k)) || (m.type !== "link" && m.attrs !== undefined) || (m.type === "link" && (!m.attrs || Object.keys(m.attrs).some(k => k !== "href") || !safeUrl(m.attrs.href)))))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(c => check(c, depth + 1)));
  }
  let valid = false;
  try { valid = check(value, 0) && (value as BodyNode).type === "doc" && Buffer.byteLength(JSON.stringify(value), "utf8") <= 5 * 1024 * 1024; } catch {}
  if (!valid) ctx.addIssue({ code: "custom", message: "正文格式不合法或超过 5MiB 限制" });
  return value as BodyNode;
});
export function safeUrl(value: unknown) { try { return typeof value === "string" && ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
