"use client";
import { useState, type ReactNode } from "react";
import { useDocumentResource } from "./useDocumentResource";
export type VersionItem = { id:number; sourceRevision:string; authorName:string; reason:string; createdAt:string; contentHash:string; content?:unknown };
const reasons:Record<string,string>={edit_start:"进入编辑前",periodic:"定期恢复点",manual:"手动保存版本",before_restore:"恢复前保护",before_draft_restore:"草稿恢复前"};
export function VersionHistory({id,generation,editing,dirty,busy,readOnly,onRestore,renderRead}:{id:number;generation:number;editing:boolean;dirty:boolean;busy:boolean;readOnly:boolean;onRestore(version:VersionItem):Promise<void>;renderRead(body:unknown,versionId?:number):ReactNode}) {
  const [selected,setSelected]=useState<number|null>(null); const [retry,setRetry]=useState(0);
  const list=useDocumentResource<{versions:VersionItem[]}>(`/api/document-nodes/${id}/versions`,generation+retry);
  const preview=useDocumentResource<{version:VersionItem}>(selected ? `/api/document-nodes/${id}/versions/${selected}` : null,generation+retry);
  return <section className="ws-version-history" aria-label="历史版本">
    <div className="ws-panel-head"><h4>历史版本（最近 10 份）</h4><button className="ws-btn" disabled={busy} onClick={()=>setRetry(x=>x+1)}>刷新版本</button></div>
    <p className="ws-doc-muted">恢复只替换正文。当前标题、目录和任务关联保持不变；恢复前自动保护当前正文。</p>
    {list.loading && <p role="status">正在读取版本…</p>}
    {list.error && <p className="ws-error" role="alert">{list.error}</p>}
    {list.data?.versions.length===0 && <p>暂无历史版本。进入编辑或手动保存版本后生成恢复点。</p>}
    <div className="ws-version-list">{list.data?.versions.map(v=><button className={`ws-btn ${selected===v.id?"primary":""}`} disabled={busy} key={v.id} onClick={()=>setSelected(v.id)}><span>{new Date(v.createdAt).toLocaleString()} · 正文修订 {v.sourceRevision}</span><small>{reasons[v.reason]??v.reason} · 正文作者：{v.authorName}</small></button>)}</div>
    {preview.loading && <p role="status">正在读取旧正文…</p>}
    {preview.error && <p className="ws-error" role="alert">{preview.error}（版本可能已超出保留数量，请刷新列表）</p>}
    {preview.data && <div className="ws-version-preview"><h4>版本预览 · 修订 {preview.data.version.sourceRevision}</h4>{renderRead(preview.data.version.content,preview.data.version.id)}<button className="ws-btn primary" disabled={busy || !editing || dirty || readOnly} onClick={()=>void onRestore(preview.data!.version)}>恢复此版本</button></div>}
    {!editing && !readOnly && <p className="ws-doc-muted">预览不占锁。需要恢复时，请先点击“编辑正文”。</p>}
    {dirty && <p className="ws-doc-muted">有未保存修改，请先保存当前正文，再恢复历史版本。</p>}
    {readOnly && <p className="ws-doc-muted">归档空间可查看历史，不可恢复。</p>}
  </section>;
}
