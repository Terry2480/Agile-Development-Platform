"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFile, fmtSize, fmtDateShort, type FileItem } from "@/lib/api-client";
import { Icon, useWorkspace } from "./shared";
type Resource = { id: number; title: string; url: string | null; attachmentId: number | null; size: number | null; createdById: number | null; author: string; createdAt: string };

export function MilestoneResources({ projectId, milestoneId, canManage }: { projectId: number; milestoneId: number; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className="ws-milestone-resources">
    <button className="ws-resource-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? "chevronDown" : "chevronRight"} size={14} />成果区<span>文件与链接</span></button>
    {open && <ResourceContent projectId={projectId} milestoneId={milestoneId} canManage={canManage} />}
  </div>;
}
function ResourceContent({ projectId, milestoneId, canManage }: { projectId: number; milestoneId: number; canManage: boolean }) {
  const ws = useWorkspace();
  const [items, setItems] = useState<Resource[] | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [fileId, setFileId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"files" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const revision = useRef(0);
  const endpoint = `/api/projects/${projectId}/milestones/${milestoneId}/resources`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++revision.current;
    const [resources, library] = await Promise.all([api<{ resources: Resource[] }>(endpoint, { signal }), api<{ files: FileItem[] }>(`/api/projects/${projectId}/files`, { signal })]);
    if (signal?.aborted || request !== revision.current) return;
    setItems(resources.resources); setFiles(library.files); setError("");
  }, [endpoint, projectId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [load]);
  async function run(write: () => Promise<unknown>, message: string) {
    if (locked.current) return;
    locked.current = true; ++revision.current; setBusy(true); setError(""); setNotice("");
    let committed = false;
    try {
      await write(); committed = true; setNotice(message); setMode(null); setFileId(""); setTitle(""); setUrl("");
      await load(); await ws.refreshFiles();
    } catch (e) { setError(committed ? "成果操作已成功，列表刷新失败，请刷新查看，无需重复提交。" : (e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  const available = files.filter((file) => !items?.some((item) => item.attachmentId === file.id));
  return <div className="ws-resource-body">
    <div className="ws-resource-actions"><button className="ws-btn primary" disabled={busy || !items} onClick={() => input.current?.click()}>上传文件</button><button className="ws-btn" disabled={busy || !items} onClick={() => setMode(mode === "files" ? null : "files")}>关联已有文件</button><button className="ws-btn" disabled={busy || !items} onClick={() => setMode(mode === "link" ? null : "link")}>添加链接</button><button className="ws-btn" disabled={busy} onClick={() => void load().catch((e: Error) => setError(e.message))}>刷新</button></div>
    <input type="file" hidden ref={input} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(() => uploadFile(`/api/projects/${projectId}/files`, file, undefined, milestoneId), "文件已上传至成果区"); }} />
    {busy && <p className="ws-team-note" role="status">正在保存…</p>}{notice && <p className="ws-team-note" role="status">{notice}</p>}
    {error && <div className="ws-error" role="alert">{error}</div>}
    {!items && !error && <p className="ws-team-note">正在加载成果…</p>}
    {items?.length === 0 && <p className="ws-team-note">暂无成果，可提交汇报 PPT、报告、演示视频或原型链接。</p>}
    {mode === "files" && <form className="ws-resource-form" onSubmit={(e) => { e.preventDefault(); if (fileId) void run(() => api(endpoint, { method: "POST", json: { attachmentId: Number(fileId) } }), "文件已关联"); }}><label>项目文件库<select className="ws-select" disabled={busy} value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">请选择文件</option>{available.map((file) => <option key={file.id} value={file.id}>{file.originalName} · {fmtSize(file.size)}</option>)}</select></label>{!available.length && <p className="ws-team-note">没有尚未关联的文件，可以直接上传。</p>}<button className="ws-btn primary" disabled={busy || !fileId}>关联</button></form>}
    {mode === "link" && <form className="ws-resource-form" onSubmit={(e) => { e.preventDefault(); void run(() => api(endpoint, { method: "POST", json: { title, url } }), "成果链接已添加"); }}><label>成果名称<input className="ws-input" required maxLength={200} disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：在线原型" /></label><label>链接<input className="ws-input" required type="url" maxLength={2000} disabled={busy} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label><button className="ws-btn primary" disabled={busy || !title.trim() || !url.trim()}>添加</button></form>}
    {items?.map((item) => <div className="ws-resource-item" key={item.id}><Icon name={item.attachmentId ? "file" : "link"} size={15} /><div><a href={item.attachmentId ? `/api/files/${item.attachmentId}` : item.url!} target={item.attachmentId ? undefined : "_blank"} rel={item.attachmentId ? undefined : "noopener noreferrer"}>{item.title}</a><small>{item.author} · {fmtDateShort(item.createdAt)}{item.size !== null ? ` · ${fmtSize(item.size)}` : " · 外部链接"}</small></div>{(canManage || item.createdById === ws.me.id) && <button className="ws-icon-btn" disabled={busy} title="从成果区移除，文件仍保留在项目文件库" aria-label={`移除成果 ${item.title}`} onClick={() => void run(() => api(endpoint, { method: "DELETE", json: { resourceId: item.id } }), "已从成果区移除")}><Icon name="trash" size={14} /></button>}</div>)}
    <p className="ws-team-note">移除成果只解除关联，文件仍保留在项目文件库。单文件最大 100MB。</p>
  </div>;
}
