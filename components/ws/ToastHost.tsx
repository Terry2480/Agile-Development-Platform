"use client";

// Toast 宿主：底部居中浮层。成功 2.2s 自动消失，失败 4.5s（颜色更醒目）。
import { useEffect, useState } from "react";
import { subscribeToast, type ToastItem } from "@/lib/toast";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToast((item) => {
    setItems((current) => [...current.slice(-2), item]); // 最多同时 3 条
    const ttl = item.kind === "error" ? 4500 : 2200;
    setTimeout(() => {
      setItems((current) => current.filter((t) => t.id !== item.id));
    }, ttl);
  }), []);

  if (items.length === 0) return null;
  return (
    <div className="ws-toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`ws-toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}
