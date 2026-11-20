/* 云文档纯函数：版本快照判定与保留窗口。数据库写入在 API 路由层完成 */

// 每篇文档保留的最近版本数；超出部分在保存时清理
export const MAX_DOC_VERSIONS = 20;

// 文档正文长度上限（字符）；Markdown 纯文本，课程场景足够
export const MAX_DOC_CONTENT_CHARS = 200_000;

// 是否需要快照旧版本：标题或正文确有变化才保存，避免无改动的重复提交撑爆历史
export function shouldSnapshotDoc(
  previous: { title: string; content: string },
  next: { title?: string; content?: string },
): boolean {
  const title = next.title ?? previous.title;
  const content = next.content ?? previous.content;
  return title !== previous.title || content !== previous.content;
}

// 返回应删除的历史版本 id：versions 按写入顺序（id 升序）传入，保留最近 keep 版
export function pruneVersionIds(versions: { id: number }[], keep = MAX_DOC_VERSIONS): number[] {
  if (versions.length <= keep) return [];
  return versions.slice(0, versions.length - keep).map((v) => v.id);
}

// 文档摘要：列表页展示正文开头，多行折叠为单行
export function docExcerpt(content: string, limit = 90): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}
