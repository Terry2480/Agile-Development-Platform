"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {DocumentDialog} from "./DocumentDialog";
import {ImagePicker} from "./ImagePicker";
import type {DocumentSpace} from "@/lib/documents/types";
import { VersionHistory, type VersionItem } from "./VersionHistory";
import { api } from "@/lib/api-client";
import type { BodyNode } from "@/lib/documents/body";
import { useWorkspace } from "../shared";
type Session = { content: BodyNode; bodyRevision: string; nodeVersion: string; name: string; expiresAt: string; savedAt: string };
type Draft = { content: BodyNode; name: string; at: string };
export function BodyEditor({ id, body, name, readOnly, renderRead, space }: { id: number; body: unknown; name: string; readOnly: boolean; space:DocumentSpace; renderRead(body: unknown,versionId?:number): ReactNode }) {
  const ws = useWorkspace();
  const [serverBody, setServerBody] = useState(body as BodyNode);
  const [content, setContent] = useState(body as BodyNode); const [title, setTitle] = useState(name);
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("阅读模式"); const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null); const [tick, setTick] = useState(0);
  const [historyOpen,setHistoryOpen]=useState(false); const [historyGeneration,setHistoryGeneration]=useState(0);
  const historyRequest=useRef<{signature:string;payload:Record<string,unknown>}|null>(null);
  const imageInput=useRef<HTMLInputElement>(null);const [imagePicker,setImagePicker]=useState(false);
  const [linkOpen,setLinkOpen]=useState(false);const [linkText,setLinkText]=useState("");const [linkUrl,setLinkUrl]=useState("");const [linkError,setLinkError]=useState("");
  const session = useRef<Session | null>(null); const token = useRef(""); const active = useRef(false);
  const saving = useRef(false); const pending = useRef<Record<string, unknown> | null>(null);
  const current = useRef({ content, name: title }); useEffect(() => { current.current = { content, name: title }; }, [content, title]);
  const saved = useRef(JSON.stringify({ content: body, name }));
  const [savedKey, setSavedKey] = useState(JSON.stringify({ content: body, name }));
  const dirty = JSON.stringify({ content, name: title }) !== savedKey;
  const dirtyRef = useRef(dirty); useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const alive = useRef(true); const focused = useRef<number[]>([]);
  const caret = useRef<{element:HTMLElement;offset:number}|null>(null);
  useLayoutEffect(() => {
    const position=caret.current; caret.current=null;
    if(!position || !position.element.isConnected || document.activeElement!==position.element || !position.element.firstChild) return;
    const range=document.createRange(); range.setStart(position.element.firstChild,Math.min(position.offset,position.element.firstChild.textContent?.length??0));range.collapse(true);
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
  },[content]);
  const endpoint = `/api/document-nodes/${id}/editor`; const key = `agile-doc-draft:${ws.me.id}:${id}`;
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => { try { const value = localStorage.getItem(key); if (value && alive.current) setDraft(JSON.parse(value)); } catch {} });
    function leave(event: BeforeUnloadEvent) { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", leave);
    return () => { alive.current = false; active.current = false; window.removeEventListener("beforeunload", leave); if (token.current) void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", lockToken: token.current }), keepalive: true }); };
  }, [key, endpoint]);
  useEffect(() => { if (dirty) { try { localStorage.setItem(key, JSON.stringify({ content, name: title, at: new Date().toISOString() })); } catch { queueMicrotask(() => { if (alive.current) setError("本机草稿存储失败，请立即保存到服务器或自行复制正文备份"); }); } } }, [content, title, dirty, key]);
  async function begin() {
    if (busy) return; setBusy(true); setError("");
    if (!token.current) token.current = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
    try {
      const result = await api<Session>(endpoint, { method: "POST", json: { action: "acquire", lockToken: token.current } });
      if (!alive.current) { void api(endpoint, { method: "POST", json: { action: "release", lockToken: token.current } }).catch(() => {}); return; }
      if (dirtyRef.current) setDraft({ ...current.current, at: new Date().toISOString() });
      session.current = result; saved.current = JSON.stringify({ content: result.content, name: result.name }); setSavedKey(saved.current);
      setServerBody(result.content); setContent(result.content); setTitle(result.name); active.current = true; setEditing(true); setStatus("已进入编辑，自动保存已开启"); pending.current = null;
    } catch (e) { setError((e as Error).message); } finally { if(alive.current) setBusy(false); }
  }
  async function save(): Promise<boolean> {
    if (!active.current || !session.current || saving.current) return false;
    if (!pending.current && JSON.stringify(current.current) === saved.current) return true;
    saving.current = true; setStatus("正在保存…"); setError("");
    const payload = pending.current ?? { action: "save", lockToken: token.current, expectedBodyRevision: session.current.bodyRevision, expectedNodeVersion: session.current.nodeVersion, content: current.current.content, name: current.current.name, requestId: crypto.randomUUID() };
    pending.current = payload;
    try {
      const result = await api<Session>(endpoint, { method: "POST", json: payload });
      if (!alive.current) return false;
      session.current = result; pending.current = null; saved.current = JSON.stringify({ content: payload.content, name: payload.name }); setSavedKey(saved.current);
      const clean = JSON.stringify(current.current) === saved.current;
      if (clean) { try { localStorage.removeItem(key); } catch {} setDraft(null); }
      setStatus(clean ? "已保存" : "有新修改，等待保存"); setTick(t => t + 1); return clean;
    } catch (e) {
      const message = (e as Error).message; setError(message); setStatus("保存失败，草稿保留在本机");
      if (/编辑锁|无权|归档|服务器内容已变化|未登录/.test(message)) { active.current = false; setEditing(false); pending.current = null; }
      return false;
    } finally { saving.current = false; }
  }
  const dirtySince=useRef(0);
  const saveRef = useRef(save); useEffect(() => { saveRef.current = save; });
  useEffect(() => { if (!editing || !dirty) {dirtySince.current=0;return;} dirtySince.current ||= Date.now();const delay=Math.max(0,Math.min(2000,15000-(Date.now()-dirtySince.current)));const timer = setTimeout(() => {dirtySince.current=Date.now();void saveRef.current();}, delay); return () => clearTimeout(timer); }, [content, title, editing, dirty, tick]);
  useEffect(() => {
    if (!editing) return;
    let cancelled = false; let running = false;
    const timer = setInterval(async () => {
      if (running || !active.current) return; running = true;
      try { const result = await api<Session>(endpoint, { method: "POST", json: { action: "renew", lockToken: token.current } }); if (!cancelled && session.current) session.current.expiresAt = result.expiresAt; }
      catch (e) { if (!cancelled) { setError((e as Error).message); setStatus("续期失败，草稿已保留"); if (!session.current || new Date(session.current.expiresAt).getTime() <= Date.now() || /编辑锁|无权|归档|未登录/.test((e as Error).message)) { active.current = false; setEditing(false); } } }
      finally { running = false; }
    }, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [editing, endpoint]);
  async function finish() { if (busy) return; setBusy(true); try { if (!await save()) return; await api(endpoint, { method: "POST", json: { action: "release", lockToken: token.current } }); active.current = false; setEditing(false); token.current = ""; setStatus("已保存 · 阅读模式"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function historyOperation(version?:VersionItem) {
    if(busy || saving.current || !active.current || !session.current) return;
    if(dirtyRef.current) { setError("请先保存当前正文，再操作历史版本"); return; }
    if(version && !window.confirm(`恢复修订 ${version.sourceRevision} 的正文？当前正文会先保存为恢复点，标题、目录和关联保持不变。`)) return;
    setBusy(true);setError("");
    const signature=JSON.stringify([version?.id??null,session.current.bodyRevision,session.current.nodeVersion]);
    const payload=historyRequest.current?.signature===signature ? historyRequest.current.payload : {lockToken:token.current,expectedBodyRevision:session.current.bodyRevision,expectedNodeVersion:session.current.nodeVersion,requestId:crypto.randomUUID(),...(!version?{action:"checkpoint"}:{})};
    historyRequest.current={signature,payload};
    try {
      const result=await api<Session>(version?`/api/document-nodes/${id}/versions/${version.id}/restore`:endpoint,{method:"POST",json:payload});
      if(!alive.current) return;
      session.current=result;historyRequest.current=null; pending.current=null;
      saved.current=JSON.stringify({content:result.content,name:result.name});setSavedKey(saved.current);
      setContent(result.content);setServerBody(result.content);setTitle(result.name);
      try{localStorage.removeItem(key);}catch{}setDraft(null);
      setStatus(version?"历史正文已恢复并保存":"版本已保存（相同正文不重复生成）");setHistoryGeneration(x=>x+1);
    }catch(e){const message=(e as Error).message;setError(message);setStatus("版本操作未确认，请重试或重新读取正文");if(/编辑锁|无权|归档|未登录/.test(message)){active.current=false;setEditing(false);}}
    finally{if(alive.current)setBusy(false);}
  }
  function appendImage(resourceId:number,name:string){setContent(old=>({...old,content:[...old.content??[],{type:"image",attrs:{resourceId,alt:name}}]}));setStatus("图片已插入，等待正文保存");}
  async function uploadImage(file:File){
    if(busy||!active.current)return;
    if(file.size>10485760||!["image/png","image/jpeg","image/webp"].includes(file.type)){setError("图片仅支持 JPG、PNG、WebP，单张不超过 10MB");return;}
    setBusy(true);setError("");const form=new FormData();form.set("file",file);form.set("lockToken",token.current);form.set("requestId",crypto.randomUUID());
    try{const response=await fetch(`/api/document-nodes/${id}/images`,{method:"POST",body:form});const result=await response.json();if(!response.ok)throw Error(result.error??"图片上传失败，请重新选择");if(alive.current)appendImage(result.resourceId,file.name);}catch(e){setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  async function chooseImage(sourceNodeId:number){const result=await api<{resourceId:number}>(`/api/document-nodes/${id}/images`,{method:"PATCH",json:{lockToken:token.current,sourceNodeId}});appendImage(result.resourceId,"引用图片");}
  async function recoverDraft(){
    if(!draft||!active.current||busy)return;
    if(!window.confirm("确认用本机草稿替换编辑区内容？当前服务器内容已在进入编辑时保留恢复点。"))return;
    setBusy(true);setError("");
    try{const images=new Set<number>();function collect(node:BodyNode){if(node.type==="image")images.add(Number(node.attrs?.resourceId));for(const child of node.content??[])collect(child);}collect(draft.content);
      for(const resourceId of images)await api(`/api/document-nodes/${id}/images`,{method:"PATCH",json:{lockToken:token.current,resourceId}});
      setContent(draft.content);setTitle(draft.name);setDraft(null);
    }catch(e){setError(`草稿图片需要重新选择，文字可先复制备份：${(e as Error).message}`);}finally{setBusy(false);}
  }
  function extendBlock(action:"row"|"column"|"item"){
    const index=focused.current[0];if(index===undefined){setError("请先点击要修改的表格或列表");return;}
    const block=content.content?.[index];if(!block||(action==="item"?!["bulletList","orderedList"].includes(block.type):block.type!=="table")){setError(action==="item"?"请先点击列表项":"请先点击表格内的文字");return;}
    change([index],old=>{if(action==="item")return {...old,content:[...old.content??[],{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"新列表项"}]}]}]};
      const cell=():BodyNode=>({type:"tableCell",content:[{type:"paragraph",content:[{type:"text",text:"单元格"}]}]});
      return {...old,content:action==="row"?[...old.content??[],{type:"tableRow",content:Array.from({length:old.content?.[0]?.content?.length??3},cell)}]:(old.content??[]).map(row=>({...row,content:[...row.content??[],cell()]}))};});
  }
  function insertTable(){setContent(old=>({...old,content:[...old.content??[],{type:"table",content:Array.from({length:3},()=>({type:"tableRow",content:Array.from({length:3},()=>({type:"tableCell",content:[{type:"paragraph",content:[{type:"text",text:"单元格"}]}]}))}))}]}));}
  function deleteBlock(){const index=focused.current[0];if(index===undefined)return;setContent(old=>{const blocks=old.content?.filter((_,i)=>i!==index)??[];return {...old,content:blocks.length?blocks:[{type:"paragraph",content:[]}]};});}
  function change(path: number[], update: (n: BodyNode) => BodyNode) { setContent(old => { const result = structuredClone(old); let n = result; for (let i=0;i<path.length-1;i++) n=n.content![path[i]]; if(path.length) (n.content ??= [])[path.at(-1)!]=update(n.content![path.at(-1)!] ?? {type:"text",text:""}); return result; }); setStatus("未保存"); }
  function add(type: string) { setContent(old => ({ ...old, content: [...old.content ?? [], (type === "bulletList" || type === "orderedList") ? { type, content: [{ type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"新列表项"}]}] }] } : { type, ...(type === "heading" ? { attrs:{level:2} } : {}), content:[{type:"text",text: type === "heading" ? "新标题" : "新段落"}] }] })); }
  function render(n: BodyNode, path: number[]): ReactNode {
    const keyPath = path.join("-");
    if (n.type === "text") {
      let style = {}; for (const mark of n.marks ?? []) { if (mark.type === "bold") style={...style,fontWeight:700}; if(mark.type === "italic") style={...style,fontStyle:"italic"}; if(mark.type === "underline") style={...style,textDecoration:"underline"}; }
      return <span key={keyPath} style={style} contentEditable={editing && !busy} suppressContentEditableWarning role={editing ? "textbox" : undefined} onFocus={() => { focused.current=path; }} onInput={e => { if((e.nativeEvent as InputEvent).isComposing) return; const text=e.currentTarget.textContent??""; if(!(e.nativeEvent as InputEvent).isComposing) caret.current={element:e.currentTarget,offset:window.getSelection()?.focusOffset??text.length}; change(path, old=>({...old,text})); }} onCompositionEnd={e=>{const text=e.currentTarget.textContent??"";change(path,old=>({...old,text}));}} onPaste={e=>{e.preventDefault();document.execCommand("insertText",false,e.clipboardData.getData("text/plain"));}} onKeyDown={e=>{if(e.key==="Enter" && !e.nativeEvent.isComposing) {e.preventDefault();add("paragraph");}}}>{n.text}</span>;
    }
    const children = n.content?.map((child,i)=>render(child,[...path,i]));
    if(n.type === "image") return <figure key={keyPath}><Image unoptimized src={`/api/document-nodes/${id}/images/${n.attrs?.resourceId}`} alt={String(n.attrs?.alt??"正文图片")} width={800} height={450} style={{width:"100%",height:"auto",maxHeight:360,objectFit:"contain"}}/>{editing&&<button className="ws-btn" disabled={busy} onClick={()=>setContent(old=>{const next=structuredClone(old);let parent=next;for(const index of path.slice(0,-1))parent=parent.content![index];parent.content!.splice(path.at(-1)!,1);return next;})}>移除图片</button>}</figure>;
    if(n.type === "hardBreak") return <br key={keyPath}/>;
    if(n.type === "horizontalRule") return <hr key={keyPath}/>;
    const contents = children?.length ? children : [render({type:"text",text:""},[...path,0])];
    if(n.type==="heading") return <h3 key={keyPath}>{contents}</h3>;
    if(n.type==="bulletList") return <ul key={keyPath}>{contents}</ul>;
    if(n.type==="orderedList") return <ol key={keyPath}>{contents}</ol>;
    if(n.type==="listItem") return <li key={keyPath}>{contents}</li>;
    if(n.type==="codeBlock") return <pre key={keyPath}>{contents}</pre>;
    if(n.type==="blockquote") return <blockquote key={keyPath}>{contents}</blockquote>;
    if(n.type==="table") return <table key={keyPath}><tbody>{contents}</tbody></table>;
    if(n.type==="tableRow") return <tr key={keyPath}>{contents}</tr>;
    if(n.type==="tableCell" || n.type==="tableHeader") return <td key={keyPath}>{contents}</td>;
    if(n.type==="doc") return <div key={keyPath}>{contents}</div>;
    return <p key={keyPath}>{contents}</p>;
  }
  return <section className="ws-body-editor" aria-label="文档正文">
    <div className="ws-doc-actions"><span role="status">{status}{dirty && !editing ? " · 有未保存草稿" : ""}</span>{!editing ? <button className="ws-btn primary" disabled={busy || readOnly} onClick={()=>void begin()}>编辑正文</button> : <><button className="ws-btn" disabled={busy} onClick={()=>void save()}>立即保存</button><button className="ws-btn primary" disabled={busy} onClick={()=>void finish()}>保存并结束编辑</button></>}</div>
    <div className="ws-doc-actions"><button className="ws-btn" disabled={busy} aria-expanded={historyOpen} onClick={()=>setHistoryOpen(v=>!v)}>历史版本</button>{editing && <button className="ws-btn" disabled={busy || dirty} onClick={()=>void historyOperation()}>保存当前版本</button>}</div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {draft && <p className="ws-doc-notice">发现本机草稿（{new Date(draft.at).toLocaleString()}）。<button className="ws-btn" disabled={!editing || busy} onClick={()=>void recoverDraft()}>使用草稿</button><button className="ws-btn" onClick={()=>{function text(n:BodyNode):string{return (n.text??"")+(n.content?.map(text).join("\n")??"");}void navigator.clipboard.writeText(text(draft.content)).catch(()=>setError("复制失败，请在下方草稿对比中手动复制"));}}>复制草稿文字</button><button className="ws-btn" onClick={()=>{try{localStorage.removeItem(key);}catch{}setDraft(null);}}>丢弃本机草稿</button></p>}
    {draft && editing && <details className="ws-body-compare"><summary>比较服务器正文与本机草稿</summary><div><section><h4>服务器正文（进入编辑时）</h4>{renderRead(serverBody)}</section><section><h4>本机草稿</h4>{renderRead(draft.content)}</section></div></details>}
    {editing && <><label className="ws-doc-field">文档标题<input className="ws-input" value={title} maxLength={200} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><div className="ws-doc-actions ws-body-toolbar">{[["paragraph","添加段落"],["heading","添加标题"],["bulletList","添加列表"],["orderedList","有序列表"],["codeBlock","代码块"]].map(([type,label])=><button className="ws-btn" key={type} disabled={busy} onClick={()=>add(type)}>{label}</button>)}{[["bold","粗体"],["italic","斜体"]].map(([type,label])=><button key={type} className="ws-btn" disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>change(focused.current,n=>n.type==="text"?{...n,marks:n.marks?.some(m=>m.type===type)?n.marks.filter(m=>m.type!==type):[...n.marks??[],{type}]}:n)}>{label}</button>)}<button className="ws-btn" disabled={busy} onClick={insertTable}>插入表格</button>{([["row","表格加行"],["column","表格加列"],["item","添加列表项"]] as const).map(([action,label])=><button key={action} className="ws-btn" disabled={busy} onClick={()=>extendBlock(action)}>{label}</button>)}<button className="ws-btn" disabled={busy} onClick={()=>setLinkOpen(true)}>插入链接</button><button className="ws-btn" disabled={busy} onClick={()=>imageInput.current?.click()}>上传图片</button><button className="ws-btn" disabled={busy} onClick={()=>setImagePicker(true)}>引用已有图片</button><button className="ws-btn" disabled={busy} onClick={deleteBlock}>删除当前段落</button><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void uploadImage(file);}}/></div></>}
    {imagePicker&&<ImagePicker space={space} onClose={()=>setImagePicker(false)} onChoose={chooseImage}/>}
    {linkOpen&&<DocumentDialog title="插入链接" onClose={()=>setLinkOpen(false)}><form onSubmit={e=>{e.preventDefault();try{const url=new URL(linkUrl);if(!["https:","http:"].includes(url.protocol))throw Error();setContent(old=>({...old,content:[...old.content??[],{type:"paragraph",content:[{type:"text",text:linkText||linkUrl,marks:[{type:"link",attrs:{href:url.href}}]}]}]}));setLinkOpen(false);setLinkText("");setLinkUrl("");}catch{setLinkError("链接必须是完整的 HTTP 或 HTTPS 地址");}}}><label className="ws-doc-field">链接文字<input className="ws-input" value={linkText} onChange={e=>setLinkText(e.target.value)}/></label><label className="ws-doc-field">网址<input className="ws-input" type="url" required value={linkUrl} onChange={e=>setLinkUrl(e.target.value)}/></label>{linkError&&<p className="ws-error" role="alert">{linkError}</p>}<footer><button className="ws-btn" type="button" onClick={()=>setLinkOpen(false)}>取消</button><button className="ws-btn primary">插入</button></footer></form></DocumentDialog>}
    {editing ? <div className="ws-doc-readbody ws-body-editable" onPaste={e=>{const file=[...e.clipboardData.files].find(f=>f.type.startsWith("image/"));if(file){e.preventDefault();void uploadImage(file);}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=[...e.dataTransfer.files].find(f=>f.type.startsWith("image/"));if(file)void uploadImage(file);}}>{render(content,[])}</div> : renderRead(content)}
    {historyOpen && <VersionHistory id={id} generation={historyGeneration} editing={editing} dirty={dirty} busy={busy} readOnly={readOnly} onRestore={historyOperation} renderRead={renderRead}/>}
    <p className="ws-doc-muted">{editing ? "停顿 2 秒自动保存，持续输入最多 15 秒保存一次，20 秒续期编辑锁。点击文字修改；回车添加段落。" : readOnly ? "归档空间只读。" : "阅读不占用编辑锁；图片按当前文档权限读取。"}</p>
  </section>;
}
