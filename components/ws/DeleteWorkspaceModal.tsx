"use client";
import { useState } from "react";
import { useWorkspace, Modal } from "./shared";
import {useDocumentResource} from "./documents/useDocumentResource";
export type DeleteTarget = { kind: "project" | "team"; id: number; name: string };
export function DeleteWorkspaceModal({ target, onClose, onDeleted }: {
  target: DeleteTarget; onClose(): void; onDeleted(): void;
}) {
  const ws = useWorkspace();
  const status=useDocumentResource<{enabled:boolean}>("/api/document-status");
  const impact=useDocumentResource<{active:number;trashed:number;projects:number;editing:{id:number;name:string;editor:string}[];destination:string|null}>(status.data?.enabled?`/api/${target.kind==="team"?"teams":"projects"}/${target.id}/deletion-impact`:null);
  const blocked=status.loading||!!status.error||(!!status.data?.enabled&&(!impact.data||!!impact.error||!!impact.data.editing.length||(target.kind==="team"&&impact.data.projects>0)));

  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = target.kind === "team" ? "解散团队" : "删除项目";
  async function submit() {
    if (blocked || busy || confirmation !== target.name) return;
    setBusy(true); setError("");
    try {
      await ws.deleteWorkspaceItem(target.kind, target.id, impact.data?{confirmPermanent:true,expectedActive:impact.data.active,expectedTrashed:impact.data.trashed}:undefined);
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
        {status.data?.enabled?(target.kind==="team"?"团队公共资料及回收站内容将永久删除；必须先逐一删除所有项目。":"项目的任务、聊天和迭代将删除；项目资料与回收站内容会转存团队公共区，保留原资料身份和回收站到期时间。"):"相关项目、任务、聊天及文件记录将删除。"}
        此操作无法撤销。已有导出任务将取消，其下载入口会失效。
      </p>
      {(status.loading||impact.loading)&&<p role="status">正在核对资料影响…</p>}
      {(status.error||impact.error)&&<p className="ws-error" role="alert">{status.error||impact.error}</p>}
      {impact.data&&<p>正常资料（含目录）{impact.data.active} 项；回收站 {impact.data.trashed} 项。{impact.data.destination&&`转存至：团队公共区 / ${impact.data.destination}。`}{target.kind==="team"&&`剩余项目 ${impact.data.projects} 个。`}{impact.data.editing.length>0&&`请先结束编辑：${impact.data.editing.map(n=>`${n.name}（${n.editor}）`).join("、")}`}</p>}
      <div className="ws-field">
        <label htmlFor="delete-confirmation">输入完整{target.kind === "team" ? "团队" : "项目"}名称以确认：{target.name}</label>
        <input id="delete-confirmation" className="ws-input" autoFocus disabled={busy} value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)} />
      </div>
      {error && <div className="ws-error" role="alert">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" disabled={busy} onClick={onClose}>取消</button>
        <button className="ws-btn danger" disabled={blocked || busy || confirmation !== target.name} onClick={submit}>
          {busy ? "处理中…" : action}
        </button>
      </div>
    </Modal>
  );
}

