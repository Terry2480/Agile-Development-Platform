"use client";
import {useState} from "react";
import type {DocumentListing,DocumentSpace} from "@/lib/documents/types";
import {documentListPath,useDocumentResource} from "./useDocumentResource";
import {DocumentDialog} from "./DocumentDialog";
export function ImagePicker({space,onClose,onChoose}:{space:DocumentSpace;onClose():void;onChoose(id:number):Promise<void>}) {
  const [source,setSource]=useState("project");const [parent,setParent]=useState<number|null>(null);const [q,setQ]=useState("");const [cursor,setCursor]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const shared=useDocumentResource<{space:DocumentSpace}>(source==="team"?`/api/teams/${space.teamId}/document-space`:null);
  const selected=source==="project"?space:shared.data?.space;
  const page=useDocumentResource<DocumentListing>(selected?documentListPath(selected.id,parent,{q,sort:"name",cursor}):null);
  function go(id:number|null){setParent(id);setCursor(null);setQ("");}
  return <DocumentDialog title="选择已有图片" busy={busy} onClose={onClose}>
    <label className="ws-doc-field">来源<select className="ws-input" disabled={busy} value={source} onChange={e=>{setSource(e.target.value);go(null);}}><option value="project">当前文档所属空间</option>{space.projectId!==null&&<option value="team">同团队公共区</option>}</select></label>
    <label className="ws-doc-field">搜索图片标题<input className="ws-input" value={q} disabled={busy} onChange={e=>{setQ(e.target.value);setCursor(null);}}/></label>
    <nav className="ws-doc-breadcrumb"><button onClick={()=>go(null)}>全部分区</button>{page.data?.path.map(n=><button key={n.id} onClick={()=>go(n.id)}> / {n.name}</button>)}</nav>
    {(page.error||shared.error||error)&&<p className="ws-error" role="alert">{error||page.error||shared.error}</p>}
    {page.loading&&<p role="status">正在读取图片…</p>}
    <div className="ws-doc-destination">{page.data?.nodes.filter(n=>n.kind==="folder"||["image/jpeg","image/png","image/webp"].includes(n.fileMimeType??"")).map(n=><button disabled={busy} key={n.id} onClick={async()=>{if(n.kind==="folder"){go(n.id);return;}setBusy(true);setError("");try{await onChoose(n.id);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{n.kind==="folder"?"▸ ":"图片 · "}{n.name}</button>)}</div>
    <p className="ws-doc-muted">仅选择 JPG、PNG、WebP，单张不超过 10MB。引用已有资源，不重复上传。</p>
    <footer><button className="ws-btn" disabled={busy} onClick={()=>setCursor(null)}>首页</button><button className="ws-btn" disabled={busy||!page.data?.nextCursor} onClick={()=>setCursor(page.data!.nextCursor)}>下一页</button><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button></footer>
  </DocumentDialog>;
}
