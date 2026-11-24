"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { VersionHistory, type VersionItem } from "./VersionHistory";
import { api } from "@/lib/api-client";
import type { BodyNode } from "@/lib/documents/body";
import { bodyMarkdown } from "@/lib/documents/export-format";
import { useWorkspace } from "../shared";
type Session = { content: BodyNode; bodyRevision: string; nodeVersion: string; name: string; expiresAt: string; savedAt: string };
type Draft = { content: BodyNode; name: string; at: string };
function editableMarkdown(body: BodyNode): string {
  const image = (id: number) => `document-image:${id}`;
  const blocks = body.content ?? [];
  if (blocks.some(block => block.type === "markdown")) {
    return blocks.map(block => {
      const source = bodyMarkdown(block, image);
      return block.type === "image" ? source.trimEnd() : source;
    }).join("");
  }
  return bodyMarkdown(body, image);
}

function markdownBody(source: string): BodyNode {
  const content: BodyNode[] = [];
  let offset = 0;
  for (const match of source.matchAll(/^!\[([^\]\r\n]*)\]\(document-image:(\d+)\)$/gm)) {
    const resourceId = Number(match[2]);
    if (!Number.isSafeInteger(resourceId) || resourceId < 1) continue;
    const index = match.index;
    if (index > offset) content.push({ type: "markdown", text: source.slice(offset, index) });
    content.push({ type: "image", attrs: { resourceId, alt: match[1] } });
    offset = index + match[0].length;
  }
  if (offset < source.length || content.length === 1 && offset === source.length) {
    content.push({ type: "markdown", text: source.slice(offset) });
  }
  return { type: "doc", content };
}

export function BodyEditor({ id, body, name, readOnly, renderRead }: { id: number; body: unknown; name: string; readOnly: boolean; renderRead(body: unknown,versionId?:number): ReactNode }) {
  const ws = useWorkspace();
  const [serverBody, setServerBody] = useState(body as BodyNode);
  const [content, setContent] = useState(body as BodyNode); const [title, setTitle] = useState(name);
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("阅读模式"); const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null); const [tick, setTick] = useState(0);
  const [historyOpen,setHistoryOpen]=useState(false); const [historyGeneration,setHistoryGeneration]=useState(0);
  const historyRequest=useRef<{signature:string;payload:Record<string,unknown>}|null>(null);
  const session = useRef<Session | null>(null); const token = useRef(""); const active = useRef(false);
  const saving = useRef(false); const pending = useRef<Record<string, unknown> | null>(null);
  const current = useRef({ content, name: title }); useEffect(() => { current.current = { content, name: title }; }, [content, title]);
  const saved = useRef(JSON.stringify({ content: body, name }));
  const [savedKey, setSavedKey] = useState(JSON.stringify({ content: body, name }));
  const dirty = JSON.stringify({ content, name: title }) !== savedKey;
  const dirtyRef = useRef(dirty); useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const alive = useRef(true);
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
  async function recoverDraft(){
    if(!draft||!active.current||busy)return;
    if(!window.confirm("确认用本机草稿替换编辑区内容？当前服务器内容已在进入编辑时保留恢复点。"))return;
    setBusy(true);setError("");
    try{const images=new Set<number>();function collect(node:BodyNode){if(node.type==="image")images.add(Number(node.attrs?.resourceId));for(const child of node.content??[])collect(child);}collect(draft.content);
      for(const resourceId of images)await api(`/api/document-nodes/${id}/images`,{method:"PATCH",json:{lockToken:token.current,resourceId}});
      setContent(draft.content);setTitle(draft.name);setDraft(null);
    }catch(e){setError(`草稿图片需要重新选择，文字可先复制备份：${(e as Error).message}`);}finally{setBusy(false);}
  }
  return <section className="ws-body-editor" aria-label="文档正文">
    <div className="ws-doc-actions">
      <span role="status">{status}{dirty && !editing ? " · 有未保存草稿" : ""}</span>
      {editing ? <>
        <button className="ws-btn" disabled={busy} onClick={() => void save()}>立即保存</button>
        <button className="ws-btn primary" disabled={busy} onClick={() => void finish()}>保存并结束编辑</button>
      </> : (
        <button className="ws-btn primary" disabled={busy || readOnly} onClick={() => void begin()}>编辑正文</button>
      )}
      <button className="ws-btn" disabled={busy} aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>历史版本</button>
      {editing && <button className="ws-btn" disabled={busy || dirty} onClick={() => void historyOperation()}>保存当前版本</button>}
    </div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {draft && <p className="ws-doc-notice">发现本机草稿（{new Date(draft.at).toLocaleString()}）。<button className="ws-btn" disabled={!editing || busy} onClick={()=>void recoverDraft()}>使用草稿</button><button className="ws-btn" onClick={()=>{void navigator.clipboard.writeText(editableMarkdown(draft.content)).catch(()=>setError("复制失败，请在下方草稿对比中手动复制"));}}>复制草稿文字</button><button className="ws-btn" onClick={()=>{try{localStorage.removeItem(key);}catch{}setDraft(null);}}>丢弃本机草稿</button></p>}
    {draft && editing && <details className="ws-body-compare"><summary>比较服务器正文与本机草稿</summary><div><section><h4>服务器正文（进入编辑时）</h4>{renderRead(serverBody)}</section><section><h4>本机草稿</h4>{renderRead(draft.content)}</section></div></details>}
    {editing ? <>
      <label className="ws-doc-field">文档标题
        <input className="ws-input" value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)} />
      </label>
      <label className="ws-doc-field">Markdown 正文
        <textarea className="ws-textarea ws-body-markdown" rows={16} value={editableMarkdown(content)} disabled={busy}
          onChange={event => { setContent(markdownBody(event.target.value)); setStatus("未保存"); }} />
      </label>
    </> : renderRead(content)}
    {historyOpen && <VersionHistory id={id} generation={historyGeneration} editing={editing} dirty={dirty} busy={busy} readOnly={readOnly} onRestore={historyOperation} renderRead={renderRead}/>}
    <p className="ws-doc-muted">{editing ? "支持 Markdown，编辑时自动保存。" : readOnly ? "归档空间只读。" : "阅读不占用编辑锁；图片按当前文档权限读取。"}</p>
  </section>;
}
