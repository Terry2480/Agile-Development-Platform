"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ProjectMember } from "@/lib/api-client";
import { canManageDuties, DEFAULT_DUTIES, LEADER_DUTY, memberDuties } from "@/lib/team-duties";
import { useWorkspace, Avatar, Icon, Modal } from "./shared";

import { InviteModal } from "./SpacePanel";
import { TeamInvitations } from "./TeamInvitations";
import { canManageInvites } from "@/lib/team-invites";
type TeamDetail = { team: { id: number; name: string; description: string | null }; myRole: string; members: ProjectMember[] };
const ROLE_TEXT: Record<string, string> = { owner: "创建者", admin: "管理员", member: "成员" };

export function TeamPanel({ teamId }: { teamId: number }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<ProjectMember | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const refresh = useCallback(async () => {
    const data = await api<TeamDetail>(`/api/teams/${teamId}`);
    setDetail(data); setError("");
  }, [teamId]);
  useEffect(() => {
    let active = true;
    const load = () => api<TeamDetail>(`/api/teams/${teamId}`).then((d) => { if (active) { setDetail(d); setError(""); } }).catch((e: Error) => { if (active) setError(e.message); });
    load(); const timer = setInterval(load, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [teamId]);
  if (!detail) return <div className="ws-empty">{error || "正在加载团队…"}{error && <button className="ws-btn" onClick={() => refresh().catch((e: Error) => setError(e.message))}>重试</button>}</div>;
  const canInvite = detail.myRole === "owner" || detail.myRole === "admin";
  const online = detail.members.filter((m) => m.online).length;
  const me = detail.members.find((m) => m.userId === ws.me.id);
  const canAssign = me ? canManageDuties(me) : detail.myRole === "owner";
  const choices = [...new Set([...DEFAULT_DUTIES, ...detail.members.flatMap(memberDuties)])];

  return (
    <section className="ws-team">
      <div className="ws-panel-head">
        <h2>团队管理 <span className="ws-count-pill">{detail.members.length} 位成员</span></h2>
        {canInvite && <button className="ws-btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={14} /> 邀请成员</button>}
      </div>
      <div className="ws-team-summary">
        <Icon name="users" size={28} />
        <div><h3>{detail.team.name}</h3><p>{detail.team.description || "一起协作，推进团队的每一个项目。"}</p></div>
        <span>{online} 人在线 · {detail.members.length} 位成员</span>
      </div>
      <h3 className="ws-team-heading">团队成员</h3>
      {(me && canManageInvites(me)) && <TeamInvitations teamId={teamId} onMembersChanged={refresh} />}
      <p className="ws-team-note">分工由负责人统一分配，同一团队的所有项目共享。展示人负责项目汇报，开发者负责核心开发。</p>
      {!canAssign && <p className="ws-team-note">你可以查看成员分工；需要调整时，请联系负责人。</p>}
      {!canInvite && <p className="ws-team-note">团队创建者和管理员可以邀请新成员。</p>}
      <div className="ws-team-members">
        {detail.members.map((m) => (
          <article key={m.userId} className="ws-team-member">
            <span className="ws-avatar-pos"><Avatar name={m.displayName} colorKey={m.userId} size="lg" /><i className={`ws-online-dot ${m.online ? "on" : ""}`} /></span>
            <div className="ws-team-identity">
              <b>{m.displayName}</b><span>{m.email}</span>
              <div className="ws-duty-tags">{memberDuties(m).length ? memberDuties(m).map((duty) => <span key={duty} className={`ws-duty-tag ${duty === LEADER_DUTY ? "leader" : ""}`}>{duty}</span>) : <span className="ws-team-note">未分配分工</span>}</div>
              {canAssign && <button className="ws-duty-edit" onClick={() => setEditing(m)}>分配分工</button>}
              {canAssign && m.role === "owner" && <small className="ws-team-note">创建者默认担任负责人</small>}
            </div>
            <span className={`ws-online-text ${m.online ? "on" : ""}`}>{m.online ? "在线" : "离线"}</span>
            <span className="ws-role-tag">{ROLE_TEXT[m.role] ?? m.role}</span>
          </article>
        ))}
      </div>
      {editing && <DutyModal member={editing} choices={choices} teamId={detail.team.id} onSaved={refresh} onClose={() => setEditing(null)} />}
      {inviting && <InviteModal teamId={teamId} onInvited={refresh} onClose={() => setInviting(false)} />}
    </section>
  );
}

function DutyModal({ member, choices, teamId, onClose, onSaved }: { member: ProjectMember; choices: string[]; teamId: number; onClose(): void; onSaved(): Promise<void> }) {
  const ws = useWorkspace();
  const [selection, setSelection] = useState<string[]>(memberDuties(member));
  const [options, setOptions] = useState(choices);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  function addCustom() {
    const label = custom.trim();
    if (!label) return setError("请填写自定义分工");
    if (label.length > 30) return setError("分工标签最多 30 个字");
    if (!selection.includes(label) && selection.length >= 10) return setError("每位成员最多 10 个分工标签");
    setOptions((items) => [...new Set([...items, label])]);
    setSelection((items) => [...new Set([...items, label])]);
    setCustom(""); setError("");
  }
  async function submit() {
    if (submitting.current || saved) return;
    const duties = [...new Set([...selection, ...(custom.trim() ? [custom.trim()] : [])])];
    if (duties.length > 10) return setError("每位成员最多 10 个分工标签");
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/teams/${teamId}/members/${member.userId}/duty`, { method: "PUT", json: { duties } });
      setSaved(true);
      await onSaved();
      await ws.refreshProjectData();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <Modal title={`分配分工 · ${member.displayName}`} onClose={busy ? () => {} : onClose}>
      <div className="ws-field">
        <label>分工标签（可多选）</label>
        <div className="ws-duty-choices" role="group" aria-label="分工标签">
          {options.map((duty) => <label key={duty} className={`ws-duty-choice ${selection.includes(duty) ? "selected" : ""}`}>
            <input type="checkbox" checked={selection.includes(duty)} disabled={busy || saved || (member.role === "owner" && duty === LEADER_DUTY)} onChange={(e) => {
              if (e.target.checked && selection.length >= 10) return setError("每位成员最多 10 个分工标签");
              setSelection((items) => e.target.checked ? [...items, duty] : items.filter((item) => item !== duty)); setError("");
            }} />{duty}
          </label>)}
        </div>
      </div>
      <div className="ws-field"><label htmlFor="custom-duty">自定义标签</label><div className="ws-duty-custom"><input id="custom-duty" className="ws-input" maxLength={30} disabled={busy || saved} value={custom} placeholder="例如：测试、设计、文档整理" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addCustom(); } }} /><button className="ws-btn" disabled={busy || saved || !custom.trim()} onClick={addCustom}>添加</button></div></div>
      {(selection.includes(LEADER_DUTY) || custom.trim() === LEADER_DUTY) && <p className="ws-team-note">负责人可以管理分工标签。创建者的负责人标签不可移除。</p>}
      {error && <div className="ws-error" role="alert">{saved ? "分工已保存，但刷新失败，请关闭后刷新页面。" : error}</div>}
      <div className="ws-modal-actions"><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy || saved} onClick={submit}>{busy ? "保存中…" : saved ? "已保存" : "保存分工"}</button></div>
    </Modal>
  );
}
