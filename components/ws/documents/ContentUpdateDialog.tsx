"use client";
import {useRef,useState} from "react";
import {api} from "@/lib/api-client";
import type {DocumentDetail} from "@/lib/documents/types";
import {DocumentDialog} from "./DocumentDialog";
export function ContentUpdateDialog({detail,onClose,onSaved}:{detail:DocumentDetail;onClose():void;onSaved():void}){
 const fileMode=!!detail.file;const [file,setFile]=useState<File|null>(null);const [name,setName]=useState(detail.node.name);const [url,setUrl]=useState(detail.url??"");const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const locked=useRef(false);const requestId=useRef(crypto.randomUUID());
 return <DocumentDialog title={fileMode?"替换文件":"修改外部链接"} busy={busy} onClose={onClose}><form onSubmit={async e=>{
  e.preventDefault();if(locked.current||!confirmed)return;locked.current=true;setBusy(true);setError("");
  try{const input={expectedVersion:detail.node.version,expectedAssociations:detail.associations.length,confirmImpact:true,requestId:requestId.current};
   if(fileMode){if(!file||!file.size||file.size>100*1024*1024)throw Error("请选择非空且不超过 100MB 的文件");const form=new FormData();form.set("file",file);for(const [key,value] of Object.entries({...input,expectedResourceId:detail.file!.resourceId}))form.set(key,String(value));const response=await fetch(`/api/document-nodes/${detail.node.id}/replace`,{method:"POST",body:form});const data=await response.json();if(!response.ok)throw Error(data.error??"替换失败");}
   else await api(`/api/document-nodes/${detail.node.id}/link`,{method:"PATCH",json:{...input,name,url}});onSaved();
  }catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 }}><p>{fileMode?"保留当前标题、目录及关联入口，切换为新文件；不保留可恢复的旧文件版本。此前复制的独立条目仍使用原文件。":"保留资料身份与关联入口，关联入口会打开新网址；不保留可恢复的网址历史。"}</p><p>影响 {detail.associations.length} 个关联入口：</p><ul>{detail.associations.map(a=><li key={`${a.type}-${a.id}`}>{a.type==="task"?"任务":"里程碑"}：{a.name}</li>)}</ul>
 {fileMode?<label className="ws-doc-field">新文件<input type="file" required disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);requestId.current=crypto.randomUUID();setConfirmed(false);}}/></label>:<><label className="ws-doc-field">标题<input className="ws-input" required maxLength={200} disabled={busy} value={name} onChange={e=>{setName(e.target.value);requestId.current=crypto.randomUUID();setConfirmed(false);}}/></label><label className="ws-doc-field">新网址<input className="ws-input" type="url" required disabled={busy} value={url} onChange={e=>{setUrl(e.target.value);requestId.current=crypto.randomUUID();setConfirmed(false);}}/></label></>}
 <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>我已核对关联影响，确认更新</label>{error&&<p className="ws-error" role="alert">{error}；若资料或关联已变化，请关闭后重新打开。</p>}<footer><button className="ws-btn" type="button" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy||!confirmed||(fileMode&&!file)}>{busy?"处理中…":"确认更新"}</button></footer></form></DocumentDialog>;
}
