"use client";
import {useEffect,useRef,useState} from "react";
import {api} from "@/lib/api-client";
import type {DocumentSpace} from "@/lib/documents/types";
import {DocumentDialog} from "./DocumentDialog";
import {useDocumentResource} from "./useDocumentResource";
export function ExportConfirm({space,rootId,label,onClose,onQueued}:{space:DocumentSpace;rootId:number|null;label:string;onClose():void;onQueued():void}) {
  const [format,setFormat]=useState("markdown");const [busy,setBusy]=useState(false);const locked=useRef(false);const [error,setError]=useState("");const [requestId]=useState(()=>crypto.randomUUID());
  async function submit(){if(locked.current)return;locked.current=true;setBusy(true);setError("");try{await api(`/api/document-spaces/${space.id}/exports`,{method:"POST",json:{rootId,format,requestId}});onQueued();}catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}}
  return <DocumentDialog title="导出资料" busy={busy} onClose={onClose}><p>范围：{space.name} / {label}</p><label className="ws-doc-field">在线文档格式<select className="ws-input" disabled={busy} value={format} onChange={e=>setFormat(e.target.value)}><option value="markdown">Markdown（含图片的 ZIP 包）</option><option value="pdf">PDF（单篇直接下载 PDF，目录生成 ZIP 包）</option></select></label><p className="ws-doc-muted">导出请求时已保存的当前版本；保留目录结构、上传文件及链接清单。不含回收站、历史或本机草稿。最多 500 份资料、解压后 500MB，结果保留 24 小时。</p>{error&&<p className="ws-error" role="alert">{error}</p>}<footer><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy} onClick={()=>void submit()}>创建导出任务</button></footer></DocumentDialog>;
}
type Job={id:number;state:string;format:string;snapshotAt:string;expiresAt:string;failures:{path:string;code:string}[];attempts:number;count:number};
const labels:Record<string,string>={queued:"等待生成",running:"正在生成",completed:"完整成功",partial:"部分成功（存在失败项）",failed:"生成失败",cancelled:"已取消",expired:"已过期"};
export function ExportJobs({space,onClose}:{space:DocumentSpace;onClose():void}) {
  const [generation,setGeneration]=useState(0);const [cursors,setCursors]=useState<(number|null)[]>([null]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const cursor=cursors.at(-1);
  const list=useDocumentResource<{exports:Job[];nextCursor:number|null}>(`/api/document-spaces/${space.id}/exports${cursor?`?cursor=${cursor}`:""}`,generation);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setGeneration(x=>x+1);},5000);return()=>clearInterval(timer);},[]);
  async function retry(id:number){if(busy)return;setBusy(true);setError("");try{await api(`/api/document-exports/${id}/retry`,{method:"POST",json:{}});setGeneration(x=>x+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <DocumentDialog title={`${space.name} · 我的导出任务`} busy={busy} onClose={onClose}>
    <p className="ws-doc-muted">仅显示你发起的任务。重试使用原快照且不延长有效期；下载时重新检查所有来源资料的当前权限。</p>
    {(error||list.error)&&<p className="ws-error" role="alert">{error||list.error}</p>}{list.loading&&!list.data&&<p role="status">正在读取导出任务…</p>}
    {list.data?.exports.map(job=><article className="ws-trash-item" key={job.id}><strong>任务 #{job.id} · {job.format.toUpperCase()} · {labels[job.state]??job.state}</strong><p>快照：{new Date(job.snapshotAt).toLocaleString()} · {job.count} 份资料</p><small>到期：{new Date(job.expiresAt).toLocaleString()} · 尝试 {job.attempts} 次</small>{job.failures?.length>0&&<ul>{job.failures.map((failure,i)=><li key={i}>{failure.path}：{failure.code}</li>)}</ul>}<div className="ws-doc-actions">{["completed","partial"].includes(job.state)&&<a className="ws-btn" href={`/api/document-exports/${job.id}/file`}>{job.state==="partial"?"下载部分结果（含失败清单）":"下载完整结果"}</a>}{["failed","partial"].includes(job.state)&&<button className="ws-btn" disabled={busy} onClick={()=>void retry(job.id)}>重试原快照</button>}</div></article>)}
    {list.data?.exports.length===0&&<p>尚未创建导出任务。</p>}
    <footer><button className="ws-btn" disabled={busy} onClick={()=>setGeneration(x=>x+1)}>刷新</button><button className="ws-btn" disabled={busy||cursors.length<=1} onClick={()=>setCursors(c=>c.slice(0,-1))}>上一页</button><button className="ws-btn" disabled={busy||!list.data?.nextCursor} onClick={()=>setCursors(c=>[...c,list.data!.nextCursor])}>下一页</button><button className="ws-btn" disabled={busy} onClick={onClose}>关闭</button></footer>
  </DocumentDialog>;
}
