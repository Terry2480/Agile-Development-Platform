"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../shared";

export function DocumentDialog({ title, busy = false, wide=false, onClose, children }: { title: string; busy?: boolean;wide?:boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`ws-doc-dialog${wide?" ws-doc-dialog-wide":""}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => {
    if (busy || e.target !== ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
  }}><div className="ws-doc-dialog-content"><header><h3 id={titleId}>{title}</h3><button type="button" className="ws-icon-btn" disabled={busy} onClick={onClose} aria-label="关闭对话框"><Icon name="x" /></button></header>{children}</div></dialog>;
}
