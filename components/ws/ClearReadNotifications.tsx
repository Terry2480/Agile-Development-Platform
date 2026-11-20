"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useWorkspace } from "./shared";

export function ClearReadNotifications() {
  const ws = useWorkspace();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function clear() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage("");
    let saved = false;
    try {
      const result = await api<{ deletedCount: number }>("/api/notifications", { method: "DELETE", json: { allRead: true } });
      saved = true;
      setMessage(result.deletedCount ? `已删除 ${result.deletedCount} 条已读通知` : "没有已读通知可删除");
      await ws.refreshNotifications();
    } catch (e) {
      setMessage(saved ? "已删除，但刷新失败，请刷新页面查看。" : (e as Error).message);
    } finally { locked.current = false; setBusy(false); }
  }
  return <div className="ws-notification-cleanup">
    <button className="ws-btn" disabled={busy} onClick={() => void clear()}>{busy ? "删除中…" : "删除已读"}</button>
    {message && <span role="status">{message}</span>}
  </div>;
}
