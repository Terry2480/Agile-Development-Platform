"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { DocumentListing, DocumentNode, DocumentSpace } from "@/lib/documents/types";
import { DocumentDialog } from "./DocumentDialog";
import { DetailDialog } from "./DocumentsPanel";
import { documentListPath, useDocumentResource } from "./useDocumentResource";

import {UploadDialog} from "./UploadDialog";
type AssociationList = { nodes: DocumentNode[]; expectedVersion: string; readOnly: boolean; projectId: number };
export function DocumentAssociations({ kind, targetId, projectId }: { kind: "task" | "milestone"; targetId: number; projectId: number }) {
  const [generation, setGeneration] = useState(0);
  const [uploading,setUploading]=useState(false);
  const [choosing, setChoosing] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const opened = useDocumentResource<{ space: DocumentSpace }>(`/api/projects/${projectId}/document-space`, generation);
  const endpoint = `/api/${kind === "task" ? "tasks" : "milestones"}/${targetId}/document-associations`;
  const list = useDocumentResource<AssociationList>(opened.data ? endpoint : null, generation);
  async function remove(node: DocumentNode) {
    if (locked.current || !list.data) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api(endpoint, { method: "POST", json: { action: "remove", nodeIds: [node.id], expectedVersion: list.data.expectedVersion, requestId: crypto.randomUUID() } });
      setNotice(`已解除“${node.name}”的关联，原资料保留`); setGeneration(x => x + 1);
    } catch (e) { setError((e as Error).message); } finally { locked.current = false; setBusy(false); }
  }
  return <section className="ws-document-associations" aria-label="关联资料">
    <div className="ws-panel-head"><h3>关联资料 <span className="ws-count-pill">{list.data?.nodes.length ?? 0}</span></h3><div className="ws-doc-actions"><button className="ws-btn" disabled={busy || !list.data || list.data.readOnly} onClick={() => setChoosing(true)}>关联已有资料</button><button className="ws-btn" disabled={busy||!list.data||list.data.readOnly} onClick={()=>setUploading(true)}>上传并关联</button><button className="ws-btn" disabled={busy} onClick={() => setGeneration(x => x + 1)}>刷新资料</button></div></div>
    {(opened.loading || list.loading) && <p role="status">正在读取关联资料…</p>}
    {(opened.error || list.error || error) && <p className="ws-error" role="alert">{error || opened.error || list.error}</p>}
    {notice && <p className="ws-team-note" role="status">{notice}</p>}
    {list.data?.readOnly && <p className="ws-team-note">项目已归档，关联资料只读。</p>}
    {list.data?.nodes.length === 0 && <p className="ws-team-note">暂无关联资料，可从本项目文档选择。</p>}
    {list.data?.nodes.map(node => <div className="ws-resource-item" key={node.id}><div><button className="ws-doc-link" onClick={() => setDetail(node.id)}>{node.name}</button><small>{node.kind === "document" ? "在线文档" : node.kind === "link" ? "外部链接" : "上传文件"} · {node.spaceId === opened.data?.space.id ? "本项目" : "团队公共区"}</small></div><button className="ws-btn" disabled={busy || list.data!.readOnly} onClick={() => void remove(node)}>解除关联</button></div>)}
    {detail !== null && <DetailDialog id={detail} onClose={() => { setDetail(null); setGeneration(x => x + 1); }} />}
    {uploading&&opened.data&&<AssociationUpload own={opened.data.space} kind={kind} targetId={targetId} onClose={()=>setUploading(false)} onSaved={()=>{setUploading(false);setGeneration(x=>x+1);setNotice("文件已保存到项目目录并完成关联");}}/>}
    {choosing && list.data && opened.data && <AssociationPicker endpoint={endpoint} own={opened.data.space} list={list.data} onClose={() => setChoosing(false)} onSaved={() => { setChoosing(false); setGeneration(x => x + 1); setNotice("资料已关联；再次打开会读取原资料的最新内容"); }} />}
  </section>;
}

function AssociationPicker({ endpoint, own, list, onClose, onSaved }: { endpoint: string; own: DocumentSpace; list: AssociationList; onClose(): void; onSaved(): void }) {
  const [parentId, setParentId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<DocumentNode[]>([]);
  const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const [requestId] = useState(() => crypto.randomUUID());
  const page = useDocumentResource<DocumentListing>(documentListPath(own.id, parentId, { q: query.trim(), sort: "name", cursor: cursors.at(-1) }), retry);
  const existing = new Set(list.nodes.map(n => n.id));
  function go(id: number | null) { setParentId(id); setQuery(""); setCursors([null]); }
  async function submit() {
    if (locked.current || !selected.length) return;
    locked.current = true; setBusy(true); setError("");
    try { await api(endpoint, { method: "POST", json: { action: "add", nodeIds: selected.map(n => n.id).sort((a,b) => a-b), expectedVersion: list.expectedVersion, requestId } }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { locked.current = false; setBusy(false); }
  }
  return <DocumentDialog title="关联已有资料" busy={busy} onClose={onClose}>
    <label className="ws-doc-field">按标题搜索<input className="ws-input" disabled={busy} maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setCursors([null]); }} placeholder="搜索本项目全部资料" /></label>
    <nav className="ws-doc-breadcrumb" aria-label="选择资料的位置"><button disabled={busy} onClick={() => go(null)}>全部分区</button>{page.data?.path.map(n => <span key={n.id}> / <button disabled={busy} onClick={() => go(n.id)}>{n.name}</button></span>)}</nav>
    {(page.loading) && <p role="status">正在读取目录…</p>}
    {(page.error) && <p className="ws-error" role="alert">{page.error}<button className="ws-btn" onClick={() => setRetry(x => x + 1)}>重试</button></p>}
    <div className="ws-doc-destination">{page.data?.nodes.map(n => n.kind === "folder" ? <button key={n.id} disabled={busy} onClick={() => go(n.id)}>▸ {n.name}</button> : <label className="ws-doc-pick-row" key={n.id}><input type="checkbox" disabled={busy || existing.has(n.id) || (selected.length >= 100 && !selected.some(s => s.id === n.id))} checked={existing.has(n.id) || selected.some(s => s.id === n.id)} onChange={e => setSelected(items => e.target.checked ? [...items, n] : items.filter(i => i.id !== n.id))} /><span>{n.name}</span><small>{existing.has(n.id) ? "已关联" : n.kind === "document" ? "在线文档" : n.kind === "link" ? "外部链接" : "上传文件"}</small></label>)}</div>
    {page.data?.nodes.length === 0 && <p className="ws-team-note">没有可选资料；请先在文档空间创建资料，或调整关键词。</p>}
    <div className="ws-doc-pagination"><span>已选 {selected.length} / 100 项（跨目录保留选择）</span><button className="ws-btn" disabled={busy || !selected.length} onClick={() => setSelected([])}>清空选择</button><button className="ws-btn" disabled={busy || cursors.length <= 1} onClick={() => setCursors(c => c.slice(0,-1))}>上一页</button><button className="ws-btn" disabled={busy || !page.data?.nextCursor} onClick={() => setCursors(c => [...c, page.data!.nextCursor])}>下一页</button></div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    <p className="ws-team-note">仅建立引用，不复制内容。批量选择全部通过校验才会保存。</p>
    <footer><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy || !selected.length} onClick={() => void submit()}>{busy ? "关联中…" : `关联所选资料（${selected.length}）`}</button></footer>
  </DocumentDialog>;
}

function AssociationUpload({own,kind,targetId,onClose,onSaved}:{own:DocumentSpace;kind:"task"|"milestone";targetId:number;onClose():void;onSaved():void}){
 const [parentId,setParentId]=useState<number|null>(null);const [chosen,setChosen]=useState<number|null>(null);const [cursors,setCursors]=useState<(string|null)[]>([null]);
 const page=useDocumentResource<DocumentListing>(documentListPath(own.id,parentId,{foldersOnly:true,sort:"name",cursor:cursors.at(-1)}));
 function go(id:number|null){setParentId(id);setCursors([null]);}
 if(chosen!==null)return <UploadDialog space={own} parentId={chosen} association={{kind,id:targetId}} onClose={onClose} onSaved={onSaved}/>;
 return <DocumentDialog title="选择项目上传目录" onClose={onClose}><p>文件会保存到本项目目录，并同时关联当前{kind==="task"?"任务":"里程碑"}。</p><nav className="ws-doc-breadcrumb"><button onClick={()=>go(null)}>全部分区</button>{page.data?.path.map(n=><button key={n.id} onClick={()=>go(n.id)}> / {n.name}</button>)}</nav>{page.error&&<p role="alert">{page.error}</p>}<div className="ws-doc-destination">{page.data?.nodes.map(n=><button key={n.id} onClick={()=>go(n.id)}>▸ {n.name}</button>)}</div><div className="ws-doc-pagination"><button disabled={cursors.length<2} onClick={()=>setCursors(c=>c.slice(0,-1))}>上一页</button><button disabled={!page.data?.nextCursor} onClick={()=>setCursors(c=>[...c,page.data!.nextCursor])}>下一页</button></div><footer><button className="ws-btn" onClick={onClose}>取消</button><button className="ws-btn primary" disabled={parentId===null||!page.data} onClick={()=>setChosen(parentId)}>上传到当前目录</button></footer></DocumentDialog>;
}
