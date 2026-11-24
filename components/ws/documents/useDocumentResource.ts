"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export type DocumentListOptions = { q?: string; foldersOnly?: boolean; sort?: string; cursor?: string | null };

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

// Key each result and error, so an old project's response never appears in a new space.
// seed：首屏列表由"打开空间"的响应一起带回；同一路径的第 0 代直接用这份数据，不重复请求。
// 写操作和手动刷新会把 generation 加一，此后一律重新取数。
export function useDocumentResource<T>(path: string | null, generation = 0, seed: { path: string; data: T } | null = null) {
  const key = `${path}|${generation}`;
  const seeded = path !== null && seed !== null && seed.path === path && generation === 0;
  const [result, setResult] = useState<{ key: string; data: T } | null>(() => (seeded && seed ? { key, data: seed.data } : null));
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (!path || seeded) return;
    const controller = new AbortController();
    let current = true;
    void api<T>(path, { signal: controller.signal }).then(data => {
      if (current) setResult({ key, data });
    }).catch((error: Error) => {
      if (current && !controller.signal.aborted) setFailure({ key, message: error.message });
    });
    return () => { current = false; controller.abort(); };
  }, [path, key, seeded]);
  const data = result?.key === key ? result.data : null;
  const error = failure?.key === key && !data ? failure.message : null;
  return { data, error, loading: path !== null && !data && !error };
}
