"use client";
import {useRef,useState} from "react";
import {DetailDialog} from "./DocumentsPanel";
import {api} from "@/lib/api-client";
import type {DocumentNode,DocumentSpace} from "@/lib/documents/types";
import {DocumentDialog} from "./DocumentDialog";
import {useDocumentResource} from "./useDocumentResource";
export function TrashConfirm({node,onClose,onSaved}:{node:DocumentNode;onClose():void;onSaved():void}) {
  const [busy,setBusy]=useState(false);const locked=useRef(false);const [error,setError]=useState("");const [requestId]=useState(()=>crypto.randomUUID());
  const impact=useDocumentResource<{count:number;folders:number;documents:number;files:number;links:number;editing:{id:number;name:string}[];references:{nodeId:number;name:string}[];expectedVersion:string}>(`/api/document-nodes/${node.id}/impact`);
  async function submit(){if(locked.current||!impact.data)return;locked.current=true;setBusy(true);setError("");try{await api(`/api/document-nodes/${node.id}/trash`,{method:"POST",json:{expectedVersion:impact.data.expectedVersion,expectedCount:impact.data.count,requestId,confirmScope:true}});onSaved();}catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}}
  return <DocumentDialog title={`移入回收站：${node.name}`} busy={busy} onClose={onClose}>
    {impact.loading&&<p role="status">正在核对范围…</p>}{(impact.error||error)&&<p className="ws-error" role="alert">{error||impact.error}</p>}
    {impact.data&&<><p>共 {impact.data.count} 项：{impact.data.folders} 个目录、{impact.data.documents} 篇文档、{impact.data.files} 个文件、{impact.data.links} 条链接。</p><p className="ws-doc-muted">所选目录及当前正常下级一起进入回收站，保留 30 天。此前单独删除的条目保持原到期时间。</p>
    {impact.data.editing.length>0&&<p className="ws-error">正在编辑：{impact.data.editing.map(n=>n.name).join("、")}。请等待编辑结束。</p>}
    {impact.data.references.length>0&&<p className="ws-error">仍有关联：{[...new Set(impact.data.references.map(n=>n.name))].join("、")}。请在资料信息中查看任务/里程碑并先解除关联。</p>}</>}
    <footer><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy||!impact.data||!!impact.data.editing.length||!!impact.data.references.length} onClick={()=>void submit()}>确认移入回收站</button></footer>
  </DocumentDialog>;
}
type Item={id:number;name:string;kind:string;version:string;parentId:number|null;batchId:number;deletedAt:string;deletedBy:string;expiresAt:string;expired:boolean;originalPath:{id:number;name:string}[];batchCount:number};
export function TrashDialog({space,onClose,onChanged}:{space:DocumentSpace;onClose():void;onChanged():void}) {
  const [preview,setPreview]=useState<number|null>(null);
  const [generation,setGeneration]=useState(0);const [cursors,setCursors]=useState<(number|null)[]>([null]);const [busy,setBusy]=useState(false);const locked=useRef(false);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");const cursor=cursors.at(-1);
  const list=useDocumentResource<{nodes:Item[];nextCursor:number|null;space:DocumentSpace;canPurge:boolean}>(`/api/document-spaces/${space.id}/trash${cursor?`?cursor=${cursor}`:""}`,generation);
  async function run(item:Item,purge:boolean){
    if(locked.current)return;
    if(purge&&!window.confirm(`永久删除“${item.name}”及其全部下级？包括其中已单独删除的条目。操作无法恢复，仍被其他资料使用的实体文件会保留。`))return;
    locked.current=true;setBusy(true);setError("");setNotice("");
    try{const result=await api<{node?:DocumentNode;path?:{name:string}[];count?:number}>(`/api/document-nodes/${item.id}/${purge?"purge":"restore"}`,{method:"POST",json:{expectedVersion:item.version,requestId:crypto.randomUUID(),...(purge?{confirmPermanent:true}:{})}});setNotice(purge?"已永久删除，资源由后台按引用情况清理":`已恢复“${result.node?.name}”到 ${result.path?.map(n=>n.name).join(" / ")}`);setGeneration(x=>x+1);onChanged();}catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
  }
  return <DocumentDialog title={`${space.name} · 回收站`} busy={busy} onClose={onClose}>
    <p className="ws-doc-muted">保留 30 天。文件夹恢复包含本次删除的下级；原目录不可用时转入“恢复的资料”，重名自动追加恢复序号。</p>
    {notice&&<p className="ws-doc-notice" role="status">{notice}</p>}{(error||list.error)&&<p className="ws-error" role="alert">{error||list.error}</p>}
    {list.loading&&<p role="status">正在读取回收站…</p>}
    {list.data?.space.readOnly&&<p>归档空间只读，请先恢复项目再恢复或清理资料。</p>}
    {list.data?.nodes.map(item=><article className="ws-trash-item" key={item.id}><button className="ws-doc-link" disabled={item.expired} onClick={()=>setPreview(item.id)}>{item.name}</button><p>{item.originalPath.map(n=>n.name).join(" / ")}</p><small>删除人：{item.deletedBy} · 删除：{new Date(item.deletedAt).toLocaleString()} · 到期：{new Date(item.expiresAt).toLocaleString()}{item.expired?" · 已到期待清理":""}</small><div className="ws-doc-actions"><button className="ws-btn" disabled={busy||item.expired||list.data!.space.readOnly} onClick={()=>void run(item,false)}>{item.kind==="folder"?"恢复文件夹及本次删除下级":"恢复"}</button>{list.data!.canPurge&&<button className="ws-btn" disabled={busy||list.data!.space.readOnly} onClick={()=>void run(item,true)}>永久删除</button>}</div></article>)}
    {list.data?.nodes.length===0&&<p>回收站为空。</p>}
    {preview!==null&&<DetailDialog id={preview} trash onClose={()=>setPreview(null)}/>}
    <footer><button className="ws-btn" disabled={busy} onClick={()=>setGeneration(x=>x+1)}>刷新</button><button className="ws-btn" disabled={busy||cursors.length<=1} onClick={()=>setCursors(c=>c.slice(0,-1))}>上一页</button><button className="ws-btn" disabled={busy||!list.data?.nextCursor} onClick={()=>setCursors(c=>[...c,list.data!.nextCursor])}>下一页</button><button className="ws-btn" disabled={busy} onClick={onClose}>关闭</button></footer>
  </DocumentDialog>;
}
