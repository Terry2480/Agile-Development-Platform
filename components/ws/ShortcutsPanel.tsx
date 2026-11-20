"use client";

// 快捷键速查面板：任意界面按 ?（Shift+/）呼出；输入框内不触发
import { useEffect, useState } from "react";
import { Modal } from "./shared";

const SHORTCUTS: [string, string][] = [
  ["Ctrl K", "全局搜索（项目 / 任务 / 文档 / 聊天 / 成员）"],
  ["Enter", "发送消息 / 确认输入"],
  ["Shift Enter", "输入框内换行"],
  ["Ctrl Enter", "发送文档评论"],
  ["Esc", "关闭搜索面板 / 弹窗"],
  ["↑ ↓", "搜索面板中选择结果"],
  ["?", "打开本速查面板"],
];

export function ShortcutsPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" ) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <Modal title="键盘快捷键" onClose={() => setOpen(false)}>
      <div className="ws-shortcuts">
        {SHORTCUTS.map(([key, desc]) => (
          <div key={key} className="ws-shortcut-row">
            <kbd>{key}</kbd>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
