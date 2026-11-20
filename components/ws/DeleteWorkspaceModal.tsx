"use client";
import { useState } from "react";
import { useWorkspace, Modal } from "./shared";
export type DeleteTarget = { kind: "project" | "team"; id: number; name: string };
export function DeleteWorkspaceModal({ target, onClose, onDeleted }: {
  target: DeleteTarget; onClose(): void; onDeleted(): void;
}) {
  const ws = useWorkspace();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = target.kind === "team" ? "解散团队" : "删除项目";
  async function submit() {
    if (busy || confirmation !== target.name) return;
    setBusy(true); setError("");
    try {
      await ws.deleteWorkspaceItem(target.kind, target.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={action} onClose={() => { if (!busy) onClose(); }}>
      <p className="ws-delete-warning">
        确定要{action}「{target.name}」吗？
        {target.kind === "team" ? "团队下所有项目及其任务、聊天记录、迭代和文件记录将一并删除。" : "项目的任务、聊天记录、迭代和文件记录将一并删除。"}
        此操作无法撤销。
      </p>
      <div className="ws-field">
        <label htmlFor="delete-confirmation">输入完整{target.kind === "team" ? "团队" : "项目"}名称以确认：{target.name}</label>
        <input id="delete-confirmation" className="ws-input" autoFocus disabled={busy} value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)} />
      </div>
      {error && <div className="ws-error" role="alert">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" disabled={busy} onClick={onClose}>取消</button>
        <button className="ws-btn danger" disabled={busy || confirmation !== target.name} onClick={submit}>
          {busy ? "处理中…" : action}
        </button>
      </div>
    </Modal>
  );
}

