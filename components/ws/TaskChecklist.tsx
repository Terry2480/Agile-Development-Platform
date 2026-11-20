"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { Icon } from "./shared";
import { CHECKLIST_CHANGED, applyChecklistChange, type ChecklistItem as Item, type ChecklistChange } from "@/lib/task-checklist";

export function TaskChecklist({ taskId }: { taskId: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const locked = useRef(false);
  const reading = useRef(false);
  const pendingChanges = useRef<ChecklistChange[]>([]);
  const endpoint = `/api/tasks/${taskId}/checklist`;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (reading.current) return;
    reading.current = true;
    pendingChanges.current = [];
    try {
      const data = await api<{ items: Item[] }>(endpoint, { signal });
      if (signal?.aborted) return;
      setItems(pendingChanges.current.reduce(applyChecklistChange, data.items)); setLoaded(true); setError("");
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    } finally { reading.current = false; if (!signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    function changed(event: Event) {
      const change = (event as CustomEvent<ChecklistChange>).detail;
      if (change.taskId !== taskId) return;
      if (reading.current) pendingChanges.current.push(change);
      setItems((rows) => applyChecklistChange(rows, change));
    }
    window.addEventListener(CHECKLIST_CHANGED, changed);
    return () => window.removeEventListener(CHECKLIST_CHANGED, changed);
  }, [taskId]);

  async function mutate(method: "POST" | "PUT" | "DELETE", json: Record<string, unknown>) {
    if (locked.current || !loaded) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ item?: Item }>(endpoint, { method, json });
      const change: ChecklistChange | null = method === "DELETE"
        ? { type: "delete", taskId, itemId: json.itemId as number }
        : result.item ? { type: "upsert", taskId, item: result.item } : null;
      if (change) window.dispatchEvent(new CustomEvent(CHECKLIST_CHANGED, { detail: change }));
      if (method === "POST") setTitle("");
      if (method === "PUT" && json.title !== undefined) setEditing(null);
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  const done = items.filter((item) => item.completed).length;
  const disabled = busy || loading || !loaded;

  return <section className="ws-checklist" aria-label="任务检查清单">
    <div className="ws-checklist-heading"><h3>检查清单</h3><span aria-live="polite">{loaded ? `${done}/${items.length} 已完成` : ""}</span>{loaded && <button className="ws-btn" disabled={busy || loading || editing !== null} onClick={() => { setLoading(true); void load(); }}>刷新</button>}</div>
    {items.length > 0 && <progress value={done} max={items.length} aria-label="清单完成进度" />}
    {loading && <p className="ws-team-note" role="status">正在加载清单…</p>}
    {error && <div className="ws-error" role="alert">{error} {!loaded && <button className="ws-btn" disabled={loading} onClick={() => { setLoading(true); void load(); }}>重试</button>}</div>}
    {loaded && !items.length && <p className="ws-team-note">把任务拆成几个小步骤，逐项勾选完成。</p>}
    <ul className="ws-checklist-items">
      {items.map((item) => <li key={item.id}>
        <input type="checkbox" aria-label={`完成步骤：${item.title}`} checked={item.completed} disabled={disabled} onChange={(e) => void mutate("PUT", { itemId: item.id, completed: e.target.checked })} />
        {editing === item.id ? <form className="ws-checklist-edit" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void mutate("PUT", { itemId: item.id, title: draft.trim() }); }}>
          <input className="ws-input" aria-label="修改步骤内容" autoFocus maxLength={200} value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} />
          <button className="ws-btn" disabled={disabled || !draft.trim()} type="submit">保存</button>
          <button className="ws-btn" disabled={busy} type="button" onClick={() => setEditing(null)}>取消</button>
        </form> : <>
          <span className={`ws-checklist-title ${item.completed ? "done" : ""}`}>{item.title}</span>
          <button className="ws-icon-btn" aria-label={`修改步骤：${item.title}`} title="修改步骤" disabled={disabled} onClick={() => { setEditing(item.id); setDraft(item.title); }}>✎</button>
          <button className="ws-icon-btn" aria-label={`删除步骤：${item.title}`} title="删除步骤" disabled={disabled} onClick={() => void mutate("DELETE", { itemId: item.id })}><Icon name="trash" size={14} /></button>
        </>}
      </li>)}
    </ul>
    <form className="ws-checklist-add" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void mutate("POST", { title: title.trim() }); }}>
      <input className="ws-input" aria-label="新步骤内容" placeholder="添加一个步骤…" maxLength={200} value={title} disabled={disabled || items.length >= 50} onChange={(e) => setTitle(e.target.value)} />
      <button className="ws-btn" disabled={disabled || !title.trim() || items.length >= 50} type="submit">添加</button>
    </form>
    {items.length >= 50 && <p className="ws-team-note">每个任务最多 50 个步骤。</p>}
    {items.length > 0 && done === items.length && <p className="ws-team-note" role="status">步骤已全部勾选，请确认交付后再将任务设为已完成。</p>}
  </section>;
}
