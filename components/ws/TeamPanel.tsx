"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type ProjectMember } from "@/lib/api-client";
import { canManageDuties, DEFAULT_DUTIES, LEADER_DUTY, memberDuty } from "@/lib/team-duties";
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
  const choices = [...new Set([...DEFAULT_DUTIES, ...detail.members.map(memberDuty).filter((d): d is string => Boolean(d))])];

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
              <span className={`ws-duty-tag ${memberDuty(m) === LEADER_DUTY ? "leader" : ""}`}>{memberDuty(m) || "未分配分工"}</span>
              {canAssign && m.role !== "owner" && <button className="ws-duty-edit" onClick={() => setEditing(m)}>分配分工</button>}
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
  const [selection, setSelection] = useState(memberDuty(member) ? `duty:${memberDuty(member)}` : "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit() {
    const duty = selection === "custom" ? custom.trim() : selection.slice(5);
    if (selection === "custom" && !duty) return setError("请填写自定义分工");
    setBusy(true);
    setError("");
    try {
      await api(`/api/teams/${teamId}/members/${member.userId}/duty`, { method: "PUT", json: { duty: duty || null } });
      setSaved(true);
      await onSaved();
      await ws.refreshProjectData();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`分配分工 · ${member.displayName}`} onClose={busy ? () => {} : onClose}>
      <div className="ws-field">
        <label htmlFor="member-duty">分工标签</label>
        <select id="member-duty" className="ws-input" value={selection} disabled={busy || saved} onChange={(e) => setSelection(e.target.value)}>
          <option value="">未分配分工</option>
          {choices.map((d) => <option key={d} value={`duty:${d}`}>{d}</option>)}
          <option value="custom">自定义分工…</option>
        </select>
      </div>
      {selection === "custom" && <div className="ws-field"><label htmlFor="custom-duty">自定义标签</label><input id="custom-duty" className="ws-input" autoFocus maxLength={30} disabled={busy || saved} value={custom} placeholder="例如：测试、设计、文档整理" onChange={(e) => setCustom(e.target.value)} /><p className="ws-team-note">最多 30 个字，保存后可分配给其他成员。</p></div>}
      {(selection === `duty:${LEADER_DUTY}` || (selection === "custom" && custom.trim() === LEADER_DUTY)) && <p className="ws-team-note">设为负责人后，该成员也可以管理团队的分工标签。</p>}
      {error && <div className="ws-error" role="alert">{saved ? "分工已保存，但刷新失败，请关闭后刷新页面。" : error}</div>}
      <div className="ws-modal-actions"><button className="ws-btn" disabled={busy} onClick={onClose}>取消</button><button className="ws-btn primary" disabled={busy || saved} onClick={submit}>{busy ? "保存中…" : saved ? "已保存" : "保存分工"}</button></div>
    </Modal>
  );
}
