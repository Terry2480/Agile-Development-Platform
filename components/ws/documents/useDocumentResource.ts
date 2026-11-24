"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { DocumentListing, DocumentSpace } from "@/lib/documents/types";
import { peekCached, peekPrefetch, putCached, startPrefetch } from "./prefetch";

export type DocumentListOptions = { q?: string; foldersOnly?: boolean; sort?: string; cursor?: string | null };
export type DocumentOpenResult = { space: DocumentSpace; listing: DocumentListing };

// 目录接口的查询参数：打开空间时把同一组参数一起发过去，首屏列表就不用再问一次。
export function documentListParams(parentId: number | null, options: DocumentListOptions = {}) {
  const params = new URLSearchParams({ sort: options.sort ?? "updated", limit: "50" });
  if (parentId !== null) params.set("parentId", String(parentId));
  if (options.q) params.set("q", options.q);
  if (options.foldersOnly) params.set("foldersOnly", "1");
  if (options.cursor) params.set("cursor", options.cursor);
  return params;
}

export function documentListPath(spaceId: number, parentId: number | null, options: DocumentListOptions = {}) {
  return `/api/document-spaces/${spaceId}/nodes?${documentListParams(parentId, options)}`;
}

// 目录位置按"账号 + 项目"保存：项目到空间本身要问服务端，按空间保存等于又要多绕一轮。
export function savedFolder(userId: number, projectId: number) {
  try { const raw = sessionStorage.getItem(`agile-doc-directory:${userId}:p${projectId}`); return raw && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null; } catch { return null; }
}

// 打开云文档只发这一个请求；参数顺序固定，预取和面板因此能用同一个地址做键。
export function documentOpenPath(projectId: number, folderId: number | null) {
  const params = documentListParams(folderId, {});
  params.set("include", "listing");
  return `/api/projects/${projectId}/document-space?${params}`;
}

// 预取结果只在"鼠标刚移上去→点开"这段很短的时间里可信，超过 10 秒就不再用它，改回正常请求。
const OPEN_FRESH_MS = 10_000;
const openKey = (userId: number, projectId: number, folderId: number | null) => `open:${userId}:${projectId}:${folderId ?? "root"}`;

// hover 图标时调用：提前把"空间 + 首屏列表"取回来，失败静默（点开时仍会正常请求并显示错误）。
export function prefetchDocumentOpen(userId: number, projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId < 1) return;
  const folderId = savedFolder(userId, projectId);
  startPrefetch(openKey(userId, projectId, folderId), () => api<DocumentOpenResult>(documentOpenPath(projectId, folderId)));
}

// 点开时调用：命中预取就直接用它的数据，不再发请求。
export function peekDocumentOpen(userId: number, projectId: number, folderId: number | null) {
  return peekPrefetch<DocumentOpenResult>(openKey(userId, projectId, folderId), OPEN_FRESH_MS);
}

type ResourceOptions = {
  // 跨调用复用（目录列表、目录树）：键前缀 + 新鲜度窗口，写操作按前缀清空。
  shared?: { prefix: string; freshMs?: number };
};

// Key each result and error, so an old project's response never appears in a new space.
// seed：首屏列表由"打开空间"的响应一起带回；同一路径的第 0 代直接用这份数据，不重复请求。
// 写操作和手动刷新会把 generation 加一，此后一律重新取数。
export function useDocumentResource<T>(path: string | null, generation = 0, seed: { path: string; data: T } | null = null, options: ResourceOptions = {}) {
  const key = `${path}|${generation}`;
  const seeded = path !== null && seed !== null && seed.path === path && generation === 0;
  // 只用稳定的原始值做依赖：调用方每次渲染都会重新构造 seed 对象，直接依赖它会让 effect 反复重启。
  const seedData = seeded && seed ? seed.data : null;
  const { shared } = options;
  const sharedKey = path !== null && shared ? `${shared.prefix}:${key}` : null;
  const sharedFreshMs = shared?.freshMs ?? 30_000;
  const [result, setResult] = useState<{ key: string; data: T } | null>(() => (seeded && seed ? { key, data: seed.data } : null));
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  // 命中缓存就在渲染期直接用，避免多一帧骨架；读缓存不改动它。
  const hit = path === null ? null : (sharedKey ? peekCached<T>(sharedKey, sharedFreshMs)?.data : null) ?? null;
  useEffect(() => {
    if (!path) return;
    if (seeded) { if (sharedKey && seedData !== null) putCached(sharedKey, seedData); return; }
    if (sharedKey && peekCached<T>(sharedKey, sharedFreshMs)) return;
    const controller = new AbortController();
    let current = true;
    void api<T>(path, { signal: controller.signal }).then(data => {
      if (!current) return;
      setResult({ key, data });
      if (sharedKey) putCached(sharedKey, data);
    }).catch((error: Error) => {
      if (current && !controller.signal.aborted) setFailure({ key, message: error.message });
    });
    return () => { current = false; controller.abort(); };
  }, [path, key, seeded, sharedKey, sharedFreshMs, seedData]);
  const data = hit ?? (result?.key === key ? result.data : null);
  const error = failure?.key === key && !data ? failure.message : null;
  return { data, error, loading: path !== null && !data && !error };
}
