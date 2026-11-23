"use client";
import Image from "next/image";
import {api} from "@/lib/api-client";
import { useEffect, useState, type ReactNode } from "react";
import type { DocumentDetail, DocumentListing, DocumentNode, DocumentSpace } from "@/lib/documents/types";
import { Avatar, Icon, useWorkspace } from "../shared";
import { CreateNodeDialog, MoveNodeDialog, RenameNodeDialog } from "./NodeDialogs";
import {ExportConfirm,ExportJobs} from "./ExportDialogs";
import { TrashConfirm, TrashDialog } from "./TrashDialogs";
import { UploadDialog } from "./UploadDialog";
import {ContentUpdateDialog} from "./ContentUpdateDialog";
import { FilePreview } from "./FilePreview";
import { BodyEditor } from "./BodyEditor";
import { DocumentDialog } from "./DocumentDialog";
import { documentListPath, useDocumentResource } from "./useDocumentResource";

type Scope = { id: number };
const kindName = { folder: "文件夹", document: "在线文档", file: "上传文件", link: "外部链接" };
const time = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

function FolderChildren({ space, parentId, current, generation, depth = 0, onSelect }: {
  space: number; parentId: number | null; current: number | null; generation: number; depth?: number; onSelect(id: number): void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useDocumentResource<DocumentListing>(documentListPath(space, parentId, { foldersOnly: true, sort: "name", cursor }), generation);
  if (depth > 30) return <p className="ws-doc-muted">目录较深，请从列表继续进入。</p>;
  return <>{page.loading && <p className="ws-doc-tree-status" role="status">读取目录…</p>}{page.error && <p className="ws-doc-tree-status" role="alert">目录加载失败，请点击刷新重试。</p>}
    {page.data?.nodes.map(folder => <FolderBranch key={`${folder.id}-${generation}`} node={folder} space={space} current={current} generation={generation} depth={depth} onSelect={onSelect} />)}
    {page.data?.nextCursor && <button className="ws-doc-tree-next" onClick={() => setCursor(page.data!.nextCursor)}>更多同级目录</button>}
    {cursor && <button className="ws-doc-tree-next" onClick={() => setCursor(null)}>返回首批目录</button>}
  </>;
}
function FolderBranch({ node, space, current, generation, depth, onSelect }: { node: DocumentNode; space: number; current: number | null; generation: number; depth: number; onSelect(id: number): void }) {
  const [expanded, setExpanded] = useState(false);
  return <div><div className="ws-doc-tree-row" style={{ paddingLeft: depth * 13 }}>
    <button className="ws-doc-expand" aria-label={`${expanded ? "收起" : "展开"}${node.name}`} aria-expanded={expanded} disabled={node.childFolderCount === 0} onClick={() => setExpanded(x => !x)}><Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} /></button>
    <button className={`ws-doc-tree-node ${current === node.id ? "active" : ""}`} aria-current={current === node.id ? "page" : undefined} onClick={() => { onSelect(node.id); setExpanded(true); }}><Icon name="folder" size={15} /><span>{node.name}</span></button>
  </div>{expanded && <FolderChildren space={space} parentId={node.id} current={current} generation={generation} depth={depth + 1} onSelect={onSelect} />}</div>;
}

function useSearch(value: string) {
  const [query, setQuery] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setQuery(value), 250); return () => clearTimeout(timer); }, [value]);
  return query;
}

function ReadBody({ body, id, versionId, trash=false }: { body: unknown; id?:number;versionId?:number;trash?:boolean }) {
  function render(value: unknown, key: string, depth = 0): ReactNode {
    if (!value || typeof value !== "object" || depth > 20) return null;
    const n = value as { type?: string; text?: string; content?: unknown[]; attrs?: { level?: number; alt?: string } };
    const children = Array.isArray(n.content) ? n.content.map((c, i) => render(c, `${key}-${i}`, depth + 1)) : null;
    if (n.type === "text") {
      let text: ReactNode = typeof n.text === "string" ? n.text : null;
      const marks = (value as {marks?:{type:string;attrs?:{href?:string}}[]}).marks;
      for(const mark of marks ?? []) {
        if(mark.type === "bold") text=<strong>{text}</strong>;
        if(mark.type === "italic") text=<em>{text}</em>;
        if(mark.type === "underline") text=<u>{text}</u>;
        if(mark.type === "strike") text=<s>{text}</s>;
        if(mark.type === "code") text=<code>{text}</code>;
        if(mark.type === "link" && typeof mark.attrs?.href === "string" && /^https?:\/\//.test(mark.attrs.href)) text=<a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">{text}</a>;
      }
      return <span key={key}>{text}</span>;
    }
    if (n.type === "paragraph") return <p key={key}>{children}</p>;
    if (n.type === "heading") return <h3 key={key}>{children}</h3>;
    if (n.type === "blockquote") return <blockquote key={key}>{children}</blockquote>;
    if (n.type === "table") return <table key={key}><tbody>{children}</tbody></table>;
    if (n.type === "tableRow") return <tr key={key}>{children}</tr>;
    if (n.type === "tableCell" || n.type === "tableHeader") return <td key={key}>{children}</td>;
    if (n.type === "horizontalRule") return <hr key={key}/>;
    if (n.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (n.type === "orderedList") return <ol key={key}>{children}</ol>;
    if (n.type === "listItem") return <li key={key}>{children}</li>;
    if (n.type === "codeBlock") return <pre key={key}>{children}</pre>;
    if (n.type === "hardBreak") return <br key={key} />;
    if (n.type === "image") {const resourceId=(value as {attrs?:{resourceId?:number}}).attrs?.resourceId;return id&&resourceId ? <Image key={key} unoptimized src={`/api/document-nodes/${id}/images/${resourceId}?${versionId?`versionId=${versionId}&`:""}${trash?"trash=1":""}`} alt={typeof n.attrs?.alt==="string"?n.attrs.alt:"正文图片"} width={800} height={450} style={{width:"100%",height:"auto",maxHeight:420,objectFit:"contain"}}/> : <p key={key}>图片预览不可用</p>; }
    return <span key={key}>{children}</span>;
  }
  return <div className="ws-doc-readbody">{render(body, "body")}</div>;
}

export function DetailDialog({ id, onClose, trash=false }: { id: number; onClose(): void; trash?:boolean }) {
  const ws = useWorkspace(); const [retry, setRetry] = useState(0);const [updating,setUpdating]=useState(false);
  const detail = useDocumentResource<DocumentDetail>(`/api/document-nodes/${id}${trash?"?trash=1":""}`, retry);
  return <DocumentDialog wide title={detail.data?.node.name ?? "资料信息"} onClose={onClose}>
    {detail.loading && <p role="status">正在读取资料…</p>}
    {detail.error && <p className="ws-error" role="alert">{detail.error}<button className="ws-btn" onClick={() => setRetry(x => x + 1)}>重试</button></p>}
    {detail.data && <><dl className="ws-doc-details"><dt>位置</dt><dd>{detail.data.space.name} / {detail.data.path.map(n => n.name).join(" / ")}</dd><dt>类型</dt><dd>{kindName[detail.data.node.kind]}</dd><dt>最近修改</dt><dd>{detail.data.node.updatedBy.name} · {time(detail.data.node.updatedAt)}</dd></dl>
      {detail.data.node.editLock && <p className="ws-doc-notice">{detail.data.node.editLock.editorName} 正在编辑</p>}
      {detail.data.body !== undefined && (detail.data.trashed ? <ReadBody body={detail.data.body} id={id} trash/> : <BodyEditor space={detail.data.space} key={id} id={id} body={detail.data.body} name={detail.data.node.name} readOnly={detail.data.space.readOnly} renderRead={(body,versionId)=><ReadBody body={body} id={id} versionId={versionId}/>}/>)}
      {detail.data.url && <p><a className="ws-doc-link" href={detail.data.url} target="_blank" rel="noopener noreferrer">打开外部链接 ↗</a><span className="ws-doc-muted ws-doc-url">{detail.data.url}</span></p>}
      {detail.data.file && <FilePreview key={`${id}:${detail.data.node.version}`} name={detail.data.node.name} file={detail.data.file}/>}
      {!detail.data.file && detail.data.legacyDownloadUrl && <a className="ws-btn" href={detail.data.legacyDownloadUrl}>下载文件</a>}
      {detail.data.file&&<p className="ws-doc-muted">原条目上传者：{detail.data.file.originalUploader} · 当前文件上传者：{detail.data.file.uploadedBy} · 上传时间：{time(detail.data.file.uploadedAt)}</p>}
      {!trash&&!detail.data.space.readOnly&&(detail.data.file||detail.data.url)&&<button className="ws-btn" onClick={()=>setUpdating(true)}>{detail.data.file?"替换文件":"修改外部链接"}</button>}
      {detail.data.operations&&detail.data.operations.length>0&&<details><summary>操作记录（最近 50 条）</summary><ul>{detail.data.operations.map(op=><li key={op.id}>{op.actor} · {op.action==="file.replaced"?"替换文件":"修改外部链接"} · {time(op.createdAt)}</li>)}</ul></details>}
      {updating&&<ContentUpdateDialog detail={detail.data} onClose={()=>setUpdating(false)} onSaved={()=>{setUpdating(false);setRetry(x=>x+1);}}/>}
      <h4>关联任务 / 里程碑</h4>{detail.data.associations.length === 0 ? <p className="ws-doc-muted">暂无关联</p> : <ul>{detail.data.associations.map(a => <li key={`${a.type}-${a.id}`}>{a.type === "task" ? <button className="ws-doc-link" onClick={() => { ws.selectProject(a.projectId); ws.openTask(a.id); onClose(); }}>{a.name}</button> : a.name}</li>)}</ul>}
    </>}
  </DocumentDialog>;
}

function DirectoryWorkspace({ scope, onScopeChange }: { scope: Scope; onScopeChange(scope: Scope): void }) {
  const ws = useWorkspace(); const [spaceRetry, setSpaceRetry] = useState(0);
  const opened = useDocumentResource<{ space: DocumentSpace }>(`/api/projects/${scope.id}/document-space`, spaceRetry);
  if (opened.error) return <section className="ws-doc-unavailable"><h2>文档空间暂不可用</h2><p role="alert">{opened.error}</p><button className="ws-btn" onClick={() => setSpaceRetry(x => x + 1)}>重试</button></section>;
  if (!opened.data) return <div className="ws-empty" role="status">正在打开文档空间…</div>;
  return <DirectoryContent key={opened.data.space.id} initialSpace={opened.data.space} scope={scope} onScopeChange={onScopeChange} userId={ws.me.id} />;
}

function DirectoryContent({ initialSpace, scope, onScopeChange, userId }: { initialSpace: DocumentSpace; scope: Scope; onScopeChange(scope: Scope): void; userId: number }) {
  const [exportRoot,setExportRoot]=useState<{id:number|null;label:string}|null>(null);const [exportsOpen,setExportsOpen]=useState(false);
  const [trashOpen,setTrashOpen]=useState(false);const [trashNode,setTrashNode]=useState<DocumentNode|null>(null);const [copyNode,setCopyNode]=useState<DocumentNode|null>(null);
  const [uploading,setUploading]=useState(false);
  const ws = useWorkspace(); const [folderId, setFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState(""); const q = useSearch(search); const [sort, setSort] = useState("updated");
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [generation, setGeneration] = useState(0);
  const [message, setMessage] = useState(""); const [createKind, setCreateKind] = useState<"folder" | "document" | "link" | null>(null);
  const [rename, setRename] = useState<DocumentNode | null>(null); const [move, setMove] = useState<DocumentNode | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null); const [openMenu, setOpenMenu] = useState<number | null>(null); const [newMenu, setNewMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (openMenu === null && !newMenu) return;
    function closeOutside(event: PointerEvent) { if (!(event.target instanceof Element) || !event.target.closest(".ws-doc-menu-wrap")) { setOpenMenu(null); setNewMenu(false); } }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpenMenu(null); setNewMenu(false); } }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, [openMenu, newMenu]);
  const page = useDocumentResource<DocumentListing>(documentListPath(initialSpace.id, folderId, { q, sort, cursor: cursors.at(-1) }), generation);
  const space = page.data?.space ?? initialSpace;
  const storageKey = `agile-doc-directory:${userId}:${space.id}`;
  useEffect(() => {
    // Load after mount; the result is still validated by the server before any content is shown.
    void Promise.resolve().then(() => { try { const old = sessionStorage.getItem(storageKey); if (old && /^[1-9][0-9]*$/.test(old)) setFolderId(Number(old)); } catch {} });
  }, [storageKey]);
  function go(id: number | null) { setFolderId(id); setSearch(""); setCursors([null]); setOpenMenu(null); setNewMenu(false); try { sessionStorage.setItem(storageKey, id === null ? "" : String(id)); } catch {} }
  function saved(node: DocumentNode, verb: string) { setCreateKind(null); setRename(null); setMove(null); setOpenMenu(null); setNewMenu(false); setGeneration(x => x + 1); setCursors([null]); setMessage(`已${verb}“${node.name}”`); }
  const path = page.data?.path ?? [];
  return <section className="ws-documents" aria-label="文档目录与资料列表">
    <aside className="ws-doc-tree"><div><p className="ws-doc-muted">所属团队：{space.teamName}</p><label className="ws-doc-scope"><span className="ws-doc-sr">选择项目</span><select value={scope.id} onChange={e => onScopeChange({ ...scope, id: Number(e.target.value) })}>
      {ws.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label></div><div className="ws-doc-tree-heading"><span>文档目录</span><button className="ws-icon-btn" disabled={space.readOnly} onClick={() => { go(null); setCreateKind("folder"); }} aria-label="新建分区"><Icon name="plus" size={14} /></button></div>
      <div className="ws-doc-tree-scroll"><button className={`ws-doc-tree-node ${folderId === null ? "active" : ""}`} onClick={() => go(null)}><Icon name="list" size={15} />全部分区</button><FolderChildren key={generation} space={space.id} parentId={null} current={folderId} generation={generation} onSelect={go} /></div>
      <div className="ws-doc-tree-foot"><button onClick={()=>setTrashOpen(true)}><Icon name="trash" size={15} />回收站</button><button onClick={()=>setExportsOpen(true)}><Icon name="download" size={15} />导出任务</button></div>
    </aside>
    <div className="ws-doc-main"><header className="ws-doc-context"><div><strong>{space.name}</strong><span>项目空间</span></div></header>
      <nav className="ws-doc-breadcrumb" aria-label="当前位置"><button onClick={() => go(null)}>项目空间</button>{path.map(n => <span key={n.id}> / <button onClick={() => go(n.id)}>{n.name}</button></span>)}</nav>
      <div className="ws-doc-titleline"><div><h2>{q ? "搜索结果" : path.at(-1)?.name ?? "全部分区"}</h2><span>{page.data ? `${page.data.total} 项` : ""}</span></div><div className="ws-doc-actions">
        <button className="ws-btn" onClick={()=>setExportRoot({id:folderId,label:path.at(-1)?.name??"全部分区"})}><Icon name="download" size={14} />导出</button>
        {folderId !== null && <button className="ws-btn" disabled={space.readOnly || !!q} onClick={()=>setUploading(true)}>上传文件</button>}
        {folderId === null ? <button className="ws-btn primary" disabled={space.readOnly || !!q} onClick={() => setCreateKind("folder")}>＋ 新建分区</button> : <div className="ws-doc-menu-wrap"><button className="ws-btn primary" disabled={space.readOnly || !!q} aria-expanded={newMenu} onClick={() => setNewMenu(x => !x)}>＋ 新建 <Icon name="chevronDown" size={12} /></button>{newMenu && <div className="ws-doc-menu"><button onClick={() => { setNewMenu(false); setCreateKind("document"); }}>在线文档</button><button onClick={() => { setNewMenu(false); setCreateKind("folder"); }}>文件夹</button><button onClick={() => { setNewMenu(false); setCreateKind("link"); }}>外部链接</button></div>}</div>}
      </div></div>
      <label className="ws-doc-template-setting">模板推荐<select className="ws-doc-sort" disabled={space.readOnly} value={space.templateSet??"none"} onChange={async e=>{try{await api(`/api/document-spaces/${space.id}/templates`,{method:"PATCH",json:{templateSet:e.target.value,expectedVersion:space.version}});setGeneration(x=>x+1);setMessage("模板推荐已更新，已有文档不变");}catch(error){setMessage((error as Error).message);}}}><option value="none">不设推荐</option><option value="general">通用课程项目</option><option value="software">软件开发项目</option></select></label>
      {space.readOnly && <p className="ws-doc-notice">项目已归档，当前为只读空间。需要修改时请由负责人或管理员先恢复项目。</p>}
      {message && <p className="ws-doc-notice" role="status">{message}<button className="ws-doc-link" onClick={() => setMessage("")}>关闭</button></p>}
      <div className="ws-doc-toolbar"><label className="ws-doc-search"><Icon name="search" size={15} /><span className="ws-doc-sr">搜索当前空间标题</span><input value={search} maxLength={200} onChange={e => { setSearch(e.target.value); setCursors([null]); }} placeholder="搜索本项目全部目录…" /></label><div className="ws-doc-actions"><select className="ws-doc-sort" aria-label="排序方式" value={sort} onChange={e => { setSort(e.target.value); setCursors([null]); }}><option value="updated">最近修改优先</option><option value="name">按名称排序</option></select><button className="ws-btn" onClick={() => { setGeneration(x => x + 1); setCursors([null]); }}>刷新</button></div></div>
      {q && <p className="ws-doc-muted">当前空间的标题搜索结果，不包含回收站。点击“所在目录”可定位资料。</p>}
      {page.loading && <div className="ws-doc-empty" role="status">正在加载资料…</div>}
      {page.error && <div className="ws-doc-empty" role="alert"><p>{page.error}</p><div className="ws-doc-actions"><button className="ws-btn" onClick={() => setGeneration(x => x + 1)}>重试</button><button className="ws-btn" onClick={() => go(null)}>返回全部分区</button></div></div>}
      {page.data && <><div className="ws-doc-table-wrap"><table className="ws-doc-table"><thead><tr><th>名称 / 类型</th><th>最近修改人</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{page.data.nodes.map(node => <tr key={node.id}><td><div className="ws-doc-name"><span className={`ws-doc-type ${node.kind}`}><Icon name={node.kind === "folder" ? "folder" : node.kind === "link" ? "link" : "file"} size={17} /></span><div><button className="ws-doc-name-button" onClick={() => node.kind === "folder" ? go(node.id) : setDetailId(node.id)}>{node.name}</button><small>{node.editLock ? `${node.editLock.editorName} 正在编辑` : node.associationCount ? `${node.associationCount} 处关联` : node.kind === "folder" ? `${node.childCount} 项` : kindName[node.kind]}</small>{q && <button className="ws-doc-location" onClick={() => go(node.parentId)}>所在目录</button>}</div></div></td><td><div className="ws-doc-person"><Avatar name={node.updatedBy.name} colorKey={node.updatedBy.id ?? node.id} size="sm" />{node.updatedBy.name}</div></td><td className="ws-doc-date">{time(node.updatedAt)}</td><td><div className="ws-doc-menu-wrap"><button className="ws-icon-btn" aria-label={`${node.name}的更多操作`} aria-expanded={openMenu === node.id} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setMenuPosition({ top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 320)), left: Math.max(8, rect.right - 165) }); setOpenMenu(x => x === node.id ? null : node.id); }}>···</button>{openMenu === node.id && <div className="ws-doc-menu" style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, right: "auto", width: 165 }}><button onClick={() => { setOpenMenu(null); if (node.kind === "folder") go(node.id); else setDetailId(node.id); }}>打开</button><button onClick={() => { setOpenMenu(null); setDetailId(node.id); }}>资料信息</button><button disabled={!node.permissions.rename} onClick={() => { setOpenMenu(null); setRename(node); }}>重命名</button><button disabled={!node.permissions.move} onClick={() => { setOpenMenu(null); setMove(node); }}>移动到…</button><button onClick={()=>{setOpenMenu(null);setCopyNode(node);}}>复制到…</button><button onClick={()=>{setOpenMenu(null);setExportRoot({id:node.id,label:node.name});}}>导出此项</button><button disabled={!node.permissions.move} onClick={()=>{setOpenMenu(null);setTrashNode(node);}}>移入回收站</button></div>}</div></td></tr>)}</tbody></table></div>
        {page.data.nodes.length === 0 && <div className="ws-doc-empty"><Icon name={q ? "search" : "folder"} size={26} /><h3>{q ? "没有找到匹配资料" : "这里还没有资料"}</h3><p>{q ? "尝试其他标题关键词，或切换到正确的空间。" : folderId === null ? "先创建一个分区，再整理项目资料。" : "新建文档、文件夹或外部链接。"}</p></div>}
        <div className="ws-doc-pagination"><span>文件夹优先 · 共 {page.data.total} 项</span><div className="ws-doc-actions"><button className="ws-btn" disabled={cursors.length <= 1} onClick={() => setCursors(c => c.slice(0, -1))}>上一页</button><button className="ws-btn" disabled={!page.data.nextCursor} onClick={() => setCursors(c => [...c, page.data!.nextCursor])}>下一页</button></div></div>
      </>}
    </div>
    {exportRoot&&<ExportConfirm space={space} rootId={exportRoot.id} label={exportRoot.label} onClose={()=>setExportRoot(null)} onQueued={()=>{setExportRoot(null);setExportsOpen(true);}}/>}
    {exportsOpen&&<ExportJobs space={space} onClose={()=>setExportsOpen(false)}/>}
    {copyNode && <MoveNodeDialog operation="copy" node={copyNode} source={space} onClose={()=>setCopyNode(null)} onSaved={node=>{setCopyNode(null);saved(node,"复制");}}/>}
    {trashNode && <TrashConfirm node={trashNode} onClose={()=>setTrashNode(null)} onSaved={()=>{setTrashNode(null);setGeneration(x=>x+1);setMessage("已移入回收站，保留 30 天");}}/>}
    {trashOpen && <TrashDialog space={space} onClose={()=>setTrashOpen(false)} onChanged={()=>setGeneration(x=>x+1)}/>}
    {uploading && folderId!==null && <UploadDialog space={space} parentId={folderId} onClose={()=>setUploading(false)} onSaved={node=>{setUploading(false);saved(node,"上传");}}/>}
    {createKind && <CreateNodeDialog kind={createKind} parentId={folderId} path={path.map(n => n.name).join(" / ") || "空间根层"} space={space} onClose={() => setCreateKind(null)} onSaved={n => saved(n, "创建")} />}
    {rename && <RenameNodeDialog node={rename} onClose={() => setRename(null)} onSaved={n => saved(n, "重命名")} />}
    {move && <MoveNodeDialog node={move} source={space} onClose={() => setMove(null)} onSaved={n => saved(n, "移动")} />}
    {detailId !== null && <DetailDialog id={detailId} onClose={() => { setDetailId(null); setGeneration(x => x + 1); }} />}
  </section>;
}

export function DocumentsPanel() {
  const ws = useWorkspace();
  if (ws.selectedId === null) return <div className="ws-empty">选择项目后查看项目文档</div>;
  return <DirectoryWorkspace key={ws.selectedId} scope={{ id: ws.selectedId }} onScopeChange={next => ws.selectProject(next.id)} />;
}
