"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

// Key each result and error, so an old project's response never appears in a new space.
export function useDocumentResource<T>(path: string | null, generation = 0) {
  const key = `${path}|${generation}`;
  const [result, setResult] = useState<{ key: string; data: T } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let current = true;
    void api<T>(path, { signal: controller.signal }).then(data => {
      if (current) setResult({ key, data });
    }).catch((error: Error) => {
      if (current && !controller.signal.aborted) setFailure({ key, message: error.message });
    });
    return () => { current = false; controller.abort(); };
  }, [path, key]);
  const data = result?.key === key ? result.data : null;
  const error = failure?.key === key && !data ? failure.message : null;
  return { data, error, loading: path !== null && !data && !error };
}

export function documentListPath(spaceId: number, parentId: number | null, options: { q?: string; foldersOnly?: boolean; sort?: string; cursor?: string | null } = {}) {
  const params = new URLSearchParams({ sort: options.sort ?? "updated", limit: "50" });
  if (parentId !== null) params.set("parentId", String(parentId));
  if (options.q) params.set("q", options.q);
  if (options.foldersOnly) params.set("foldersOnly", "1");
  if (options.cursor) params.set("cursor", options.cursor);
  return `/api/document-spaces/${spaceId}/nodes?${params}`;
}
