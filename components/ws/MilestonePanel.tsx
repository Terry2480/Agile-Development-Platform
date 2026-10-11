"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { milestoneDays } from "@/lib/milestones";
import { Modal, useWorkspace } from "./shared";

type Milestone = { id: number; name: string; dueOn: string; requirements: string; completed: boolean; taskIds: number[] };

export function MilestonePanel({ projectId }: { projectId: number }) {
  const ws = useWorkspace();
  const [items, setItems] = useState<Milestone[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const canManage = ws.detail?.project.id === projectId && ["owner", "admin"].includes(ws.detail.myRole);
  const url = `/api/projects/${projectId}/milestones`;
  async function refresh() { const d = await api<{ milestones: Milestone[] }>(url); setItems(d.milestones); setError(""); }
  useEffect(() => {
    let active = true;
    const load = () => api<{ milestones: Milestone[] }>(url).then((d) => { if (active) { setItems(d.milestones); setError(""); } }).catch((e: Error) => { if (active) setError(e.message); });
    load(); const timer = setInterval(load, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  const next = items?.find((m) => !m.completed);
  return <section className="ws-space-section ws-milestones">
    <div className="ws-panel-head"><h2>课程里程碑 <span className="ws-count-pill">{items?.length ?? 0}</span></h2>{canManage && <button className="ws-btn primary" onClick={() => setEditing("new")}>＋ 创建里程碑</button>}</div>
    {error && <div className="ws-error" role="alert">{error}<button className="ws-btn" onClick={() => refresh().catch((e: Error) => setError(e.message))}>重试</button></div>}
    {!items && !error && <div className="ws-empty">正在加载里程碑…</div>}
    {items?.length === 0 && <div className="ws-empty">暂无里程碑，可添加开题、中期检查、最终汇报等课程节点。{!canManage && "请联系创建者或管理员添加。"}</div>}
    {next && <div className="ws-team-summary"><div><h3>下一项交付：{next.name}</h3><p>截止 {next.dueOn} · {milestoneDays(next.dueOn) < 0 ? `已逾期 ${-milestoneDays(next.dueOn)} 天` : milestoneDays(next.dueOn) === 0 ? "今天截止" : `剩余 ${milestoneDays(next.dueOn)} 天`}</p></div></div>}
    {items?.map((m) => {
      const linked = ws.tasks.filter((t) => t.projectId === projectId && m.taskIds.includes(t.id));
      const done = linked.filter((t) => t.status === "done").length;
      const ready = m.taskIds.length > 0 && done === m.taskIds.length;
      const days = milestoneDays(m.dueOn);
      return <article className={`ws-milestone ${!m.completed && days < 0 ? "overdue" : ""}`} key={m.id}>
        <div className="ws-panel-head"><h3>{m.name}</h3><span className="ws-role-tag">{m.completed ? "已完成" : days < 0 ? "已逾期" : "未完成"}</span></div>
        <p className="ws-team-note">截止日期：{m.dueOn}</p><p className="ws-milestone-requirements">{m.requirements || "未填写交付要求"}</p>
        {m.taskIds.length > 0 && <><p className="ws-team-note">关联任务 {done} / {m.taskIds.length} 已完成{ready && !m.completed ? " · 可以确认完成" : ""}</p><div className="ws-progress"><i style={{ width: `${done / m.taskIds.length * 100}%` }} /></div>{linked.map((t) => <button className="ws-milestone-task" key={t.id} onClick={() => ws.openTask(t.id)}>{t.status === "done" ? "✓" : "○"} {t.code} {t.title}</button>)}</>}
        {canManage && <div className="ws-management-actions"><button className="ws-btn" onClick={() => setEditing(m)}>编辑 / {m.completed ? "重新开启" : "确认完成"}</button><button className="ws-btn danger" onClick={() => setDeleting(m)}>删除</button></div>}
      </article>;
    })}
    {editing && <MilestoneEditor key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} url={url} projectId={projectId} onClose={() => setEditing(null)} onSaved={refresh} />}
    {deleting && <DeleteMilestone item={deleting} url={url} onClose={() => setDeleting(null)} onSaved={refresh} />}
  </section>;
}

function MilestoneEditor({ item, url, projectId, onClose, onSaved }: { item: Milestone | null; url: string; projectId: number; onClose(): void; onSaved(): Promise<void> }) {
  const ws = useWorkspace();
  const [name, setName] = useState(item?.name ?? "");
  const [dueOn, setDueOn] = useState(item?.dueOn ?? "");
  const [requirements, setRequirements] = useState(item?.requirements ?? "");
  const [completed, setCompleted] = useState(item?.completed ?? false);
  const [taskIds, setTaskIds] = useState(item?.taskIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit() {
    setBusy(true); setError("");
    try { await api(item ? `${url}?milestoneId=${item.id}` : url, { method: item ? "PUT" : "POST", json: { name, dueOn, requirements, completed, taskIds } }); setSaved(true); await onSaved(); onClose(); }
    catch (e) { setError(saved ? "已保存，请关闭窗口并刷新列表。" : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={item ? "编辑里程碑" : "创建课程里程碑"} onClose={busy ? () => {} : onClose}>
    <fieldset disabled={busy || saved} className="ws-milestone-fields">
      <div className="ws-field"><label htmlFor="milestone-name">名称</label><input id="milestone-name" className="ws-input" autoFocus maxLength={80} placeholder="例如：中期检查" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="ws-field"><label htmlFor="milestone-date">截止日期</label><input id="milestone-date" className="ws-input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></div>
      <div className="ws-field"><label htmlFor="milestone-requirements">交付要求</label><textarea id="milestone-requirements" className="ws-textarea" maxLength={2000} placeholder="需要提交哪些材料、达到什么目标？" value={requirements} onChange={(e) => setRequirements(e.target.value)} /></div>
      <div className="ws-field"><label>关联任务（可选）</label><div className="ws-milestone-choices">{ws.tasks.filter((t) => t.projectId === projectId).map((t) => <label key={t.id}><input type="checkbox" checked={taskIds.includes(t.id)} onChange={(e) => setTaskIds(e.target.checked ? [...taskIds, t.id] : taskIds.filter((id) => id !== t.id))} /> {t.code} {t.title}</label>)}</div></div>
      <label className="ws-team-note"><input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} /> 已完成交付（手动确认，任务完成不会自动完成里程碑）</label>
    </fieldset>
    {error && <div className="ws-error" role="alert">{error}</div>}
    <div className="ws-modal-actions"><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy || saved || !name.trim() || !dueOn} onClick={submit}>{busy ? "保存中…" : saved ? "已保存" : "保存"}</button></div>
  </Modal>;
}

function DeleteMilestone({ item, url, onClose, onSaved }: { item: Milestone; url: string; onClose(): void; onSaved(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  async function submit() { setBusy(true); try { await api(`${url}?milestoneId=${item.id}`, { method: "DELETE" }); setDeleted(true); await onSaved(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title="删除里程碑" onClose={busy ? () => {} : onClose}><p>确认删除「{item.name}」？关联的任务会保留。</p>{error && <p className="ws-error">{deleted ? "已删除，请关闭窗口并刷新列表。" : error}</p>}<div className="ws-modal-actions"><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn danger" disabled={busy || deleted} onClick={submit}>{busy ? "删除中…" : deleted ? "已删除" : "确认删除"}</button></div></Modal>;
}
