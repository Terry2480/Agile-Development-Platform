"use client";
import {useRef,useState,type FormEvent} from "react";
import type {DocumentNode,DocumentSpace} from "@/lib/documents/types";
import {DocumentDialog} from "./DocumentDialog";
export function UploadDialog({space,parentId,association,onClose,onSaved}:{space:DocumentSpace;parentId:number;association?:{kind:"task"|"milestone";id:number};onClose():void;onSaved(node:DocumentNode):void}) {
  const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const locked=useRef(false);const requestId=useRef(crypto.randomUUID());
  async function submit(event:FormEvent) {
    event.preventDefault();if(locked.current || !file)return;
    if(!file.size || file.size>100*1024*1024){setError("请选择非空且不超过 100MB 的文件");return;}
    locked.current=true;setBusy(true);setError("");
    const form=new FormData();form.set("file",file);form.set("parentId",String(parentId));form.set("requestId",requestId.current);if(association)form.set(association.kind==="task"?"taskId":"milestoneId",String(association.id));
    try {
      const response=await fetch(`/api/document-spaces/${space.id}/uploads`,{method:"POST",body:form});
      const data=await response.json();if(!response.ok)throw Error(data.error??"上传失败，请重试");onSaved(data.node);
    }catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
  }
  return <DocumentDialog title="上传文件" busy={busy} onClose={onClose}><form onSubmit={submit}>
    <p className="ws-doc-muted">上传到：{space.name} / 当前目录。单文件最大 100MB，同名资料不会覆盖。</p>
    <label className="ws-doc-field">文件<input className="ws-doc-file-picker" type="file" required disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);requestId.current=crypto.randomUUID();setError("");}}/></label>
    {error && <p className="ws-error" role="alert">{error}。可保留当前选择重试。</p>}
    {busy && <p role="status">正在上传，请保持窗口开启…</p>}
    <footer><button type="button" className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy||!file}>{busy?"上传中…":"上传"}</button></footer>
  </form></DocumentDialog>;
}
