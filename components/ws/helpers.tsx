"use client";

// 展示辅助：displayName 回落 + @提及文本高亮渲染
import type { ReactNode } from "react";
import type { Me } from "@/lib/api-client";

export function displayNameOf(me: Pick<Me, "name" | "studentId">): string {
  return me.name || me.studentId;
}

// 把消息里的 @提及 渲染成蓝色高亮（匹配给定成员名集合）
export function renderMentions(content: string, memberNames: string[]): ReactNode[] {
  if (memberNames.length === 0) return [content];
  const pattern = new RegExp(
    `(@(?:${memberNames.map(escapeRegExp).join("|")}))`,
    "g",
  );
  return content.split(pattern).map((part, i) =>
    part.startsWith("@") && memberNames.includes(part.slice(1))
      ? <span key={i} className="ws-mention">{part}</span>
      : <span key={i}>{part}</span>,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
