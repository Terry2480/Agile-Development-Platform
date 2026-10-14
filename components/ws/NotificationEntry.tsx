"use client";
import { useRef, useState } from "react";
import { type NotificationItem, fmtTime, fmtDateShort } from "@/lib/api-client";
import { Icon, useWorkspace } from "./shared";

export function NotificationEntry({ notification: n, onOpened }: { notification: NotificationItem; onOpened?(): void }) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function open() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { if (await ws.openNotification(n)) onOpened?.(); }
    catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="ws-notification-entry">
    <button className={`ws-notif ${n.read ? "" : "unread"}`} disabled={busy} onClick={() => void open()} aria-label={`查看通知：${n.title}`}>
      <span className="n-ic"><Icon name={n.type === "deadline" ? "bell" : n.type === "assigned" ? "flag" : n.type === "mention" ? "at" : "message"} size={15} /></span>
      <span className="ws-notification-content">{n.title}<span className="n-time">{fmtDateShort(n.createdAt)} {fmtTime(n.createdAt)}{busy ? " · 正在打开…" : ""}</span></span>
    </button>
    {error && <div className="ws-error ws-notification-error" role="alert">{error}</div>}
  </div>;
}
