"use client";
import { useRef, useState, type FormEvent } from "react";
import {DOCUMENT_TEMPLATES} from "@/lib/documents/templates";
import { api } from "@/lib/api-client";
import type { DocumentListing, DocumentNode, DocumentSpace } from "@/lib/documents/types";
import { useWorkspace } from "../shared";
import { DocumentDialog } from "./DocumentDialog";
import { documentListPath, useDocumentResource } from "./useDocumentResource";

const errorText = (e: unknown) => e instanceof Error ? e.message : "操作失败，请重试";

export function CreateNodeDialog({ kind, parentId, path, space, onClose, onSaved }: {
  kind: "folder" | "document" | "link"; parentId: number | null; path: string; space: DocumentSpace;
  onClose(): void; onSaved(node: DocumentNode): void;
}) {
  const [templateKey,setTemplateKey]=useState("blank");
  const [name, setName] = useState(""); const [url, setUrl] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const label = kind === "folder" ? parentId === null ? "分区" : "文件夹" : kind === "document" ? "在线文档" : "外部链接";
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ node: DocumentNode }>(`/api/document-spaces/${space.id}/nodes`, { method: "POST", json: { kind, parentId, name, requestId, ...(kind === "link" ? { url } : kind === "document" ? {templateKey} : {}) } });
      onSaved(result.node);
    } catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <DocumentDialog title={`新建${label}`} busy={busy} onClose={onClose}><form onSubmit={submit}>
    <p className="ws-doc-muted">创建到：{space.name} / {path}</p>
    <label className="ws-doc-field">名称<input className="ws-input" autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder={`填写${label}名称`} /></label>
    {kind === "link" && <label className="ws-doc-field">网址<input className="ws-input" type="url" required value={url} maxLength={8000} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>}
    {kind === "document" && <label className="ws-doc-field">创建方式<select className="ws-input" value={templateKey} onChange={e=>setTemplateKey(e.target.value)}><option value="blank">空白文档</option>{[...DOCUMENT_TEMPLATES].sort((a,b)=>space.templateSet==="software" ? Number(b.group==="software")-Number(a.group==="software"):0).map(t=><option key={t.key} value={t.key}>{t.name}（{t.group==="software"?"软件开发":"通用课程"}）</option>)}</select><small>全部模板均可选；推荐组合只影响顺序，不修改已有文档。</small></label>}
    {error && <p className="ws-error" role="alert">{error}</p>}
    <footer><button type="button" className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy}>{busy ? "创建中…" : "创建"}</button></footer>
  </form></DocumentDialog>;
}

export function RenameNodeDialog({ node, onClose, onSaved }: { node: DocumentNode; onClose(): void; onSaved(node: DocumentNode): void }) {
  const [name, setName] = useState(node.name); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { onSaved((await api<{ node: DocumentNode }>(`/api/document-nodes/${node.id}`, { method: "PATCH", json: { name, expectedVersion: node.version } })).node); }
    catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <DocumentDialog title="重命名" busy={busy} onClose={onClose}><form onSubmit={submit}><label className="ws-doc-field">名称<input autoFocus className="ws-input" required value={name} maxLength={200} onChange={e => setName(e.target.value)} /></label>{error && <p className="ws-error" role="alert">{error}</p>}<footer><button type="button" className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy}>{busy ? "保存中…" : "保存名称"}</button></footer></form></DocumentDialog>;
}

export function MoveNodeDialog({ node, source, onClose, onSaved, operation = "move" }: { operation?: "move" | "copy"; node: DocumentNode; source: DocumentSpace; onClose(): void; onSaved(node: DocumentNode): void }) {
  const ws = useWorkspace();
  const [scope, setScope] = useState(source.projectId ? `project:${source.projectId}` : `team:${source.teamId}`);
  const [parentId, setParentId] = useState<number | null>(null); const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [retry, setRetry] = useState(0); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [type, id] = scope.split(":");
  const destination = useDocumentResource<{ space: DocumentSpace }>(`/api/${type === "project" ? "projects" : "teams"}/${id}/document-space`, retry);
  const page = useDocumentResource<DocumentListing>(destination.data ? documentListPath(destination.data.space.id, parentId, { foldersOnly: true, sort: "name", cursor: cursors.at(-1) }) : null, retry);
  const enter = (id: number | null) => { setParentId(id); setCursors([null]); };
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current || !destination.data || !page.data) return;
    lock.current = true; setBusy(true); setError("");
    try { onSaved((await api<{ node: DocumentNode }>(`/api/document-nodes/${node.id}/${operation}`, { method: "POST", json: { targetSpaceId: destination.data.space.id, targetParentId: parentId, expectedVersion: node.version, requestId } })).node); }
    catch (e) { setError(errorText(e)); } finally { lock.current = false; setBusy(false); }
  }
  return <DocumentDialog title={`${operation === "copy" ? "复制" : "移动"}“${node.name}”`} busy={busy} onClose={onClose}><form onSubmit={submit}>
    <label className="ws-doc-field">目标空间<select className="ws-input" disabled={busy} value={scope} onChange={e => { setScope(e.target.value); enter(null); setError(""); }}>
      <option value={`team:${source.teamId}`}>{source.teamName} / 团队公共资料</option>
      {ws.projects.filter(p => p.teamId === source.teamId).map(p => <option key={p.id} value={`project:${p.id}`} disabled={p.status === "archived"}>{p.name}{p.status === "archived" ? "（归档，只读）" : ""}</option>)}
    </select></label>
    <nav className="ws-doc-breadcrumb" aria-label="目标位置"><button type="button" onClick={() => enter(null)}>全部分区</button>{page.data?.path.map(n => <span key={n.id}> / <button type="button" onClick={() => enter(n.id)}>{n.name}</button></span>)}</nav>
    {(destination.loading || page.loading) && <p role="status" className="ws-doc-muted">正在读取目标目录…</p>}
    {(destination.error || page.error) && <p className="ws-error" role="alert">{destination.error || page.error}<button type="button" className="ws-btn" onClick={() => setRetry(x => x + 1)}>重试</button></p>}
    <div className="ws-doc-destination">{page.data?.nodes.map(folder => <button type="button" key={folder.id} disabled={busy || folder.id === node.id} onClick={() => enter(folder.id)}>▸ {folder.name}</button>)}{page.data?.nodes.length === 0 && <p className="ws-doc-muted">此处没有子文件夹，可以选择当前目录。</p>}</div>
    <div className="ws-doc-pagination"><button type="button" className="ws-btn" disabled={cursors.length <= 1 || busy} onClick={() => setCursors(c => c.slice(0, -1))}>上一页</button><button type="button" className="ws-btn" disabled={!page.data?.nextCursor || busy} onClick={() => setCursors(c => [...c, page.data!.nextCursor])}>下一页</button></div>
    <p className="ws-doc-muted">{operation === "copy" ? "复制到" : "移动到"}：{destination.data?.space.name ?? "…"} / {page.data?.path.map(n => n.name).join(" / ") || "空间根层"}</p>
    {parentId === null && node.kind !== "folder" && <p className="ws-doc-muted">请先进入分区或文件夹，资料不能直接放在空间根层。</p>}
    {error && <p className="ws-error" role="alert">{error}</p>}
    <footer><button type="button" className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy || !page.data || destination.data?.space.readOnly || (parentId === null && node.kind !== "folder")}>{busy ? "处理中…" : operation === "copy" ? "复制到此处" : "移动到此处"}</button></footer>
  </form></DocumentDialog>;
}
