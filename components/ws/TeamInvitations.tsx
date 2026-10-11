"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useWorkspace, Modal } from "./shared";

type Invite = { code: string; expiresAt: string } | null;
type JoinRequest = { id: number; displayName?: string; email?: string; teamName?: string; status?: string };

export function TeamInvitations({ teamId, onMembersChanged }: { teamId?: number; onMembersChanged?: () => Promise<void> }) {
  const ws = useWorkspace();
  const [invite, setInvite] = useState<Invite>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState(false);
  const url = teamId ? `/api/teams/${teamId}` : "/api/teams";
  const refreshTeams = ws.refreshTeams;
  const refreshProjects = ws.refreshProjects;
  const load = useCallback(async () => {
    const data = await api<{ requests: JoinRequest[] }>(teamId ? `${url}/join-requests` : `${url}/join`);
    setRequests(data.requests);
    if (teamId) { const result = await api<{ invite: Invite }>(`${url}/invite`); setInvite(result.invite); }
    else if (data.requests.some((r) => r.status === "approved")) await Promise.all([refreshTeams(), refreshProjects()]);
  }, [teamId, url, refreshTeams, refreshProjects]);
  useEffect(() => {
    let active = true;
    const run = () => { if (active) load().catch((e: Error) => { if (active) setError(e.message); }); };
    run(); const timer = setInterval(run, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [load]);
  async function act(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    let succeeded = false;
    try { await action(); succeeded = true; setNotice(message); setReset(false); await load(); await onMembersChanged?.(); await Promise.all([refreshTeams(), refreshProjects()]); }
    catch (e) { setError(succeeded ? `${message}，但刷新失败，请稍后刷新页面。` : (e as Error).message); }
    finally { setBusy(false); }
  }
  const expired = invite && new Date(invite.expiresAt) <= new Date();
  return <section className="ws-invitations">
    <h3>{teamId ? "邀请码与加入申请" : "通过邀请码加入团队"}</h3>
    {teamId ? <>
      <p className="ws-team-note">邀请码有效期 7 天。同学登录后输入邀请码申请，审核通过才会加入团队及其全部项目。</p>
      {invite && <div className="ws-invite-code"><code>{invite.code}</code><span>{expired ? "已过期" : `有效至 ${new Date(invite.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}`}</span></div>}
      <div className="ws-management-actions">
        {invite && !expired && <button className="ws-btn" onClick={async () => { try { await navigator.clipboard.writeText(invite.code); setNotice("邀请码已复制"); } catch { setError("复制失败，请选中邀请码手动复制"); } }}>复制邀请码</button>}
        <button className="ws-btn primary" disabled={busy} onClick={() => invite ? setReset(true) : act(() => api(`${url}/invite`, { method: "POST" }), "邀请码已生成")}>{invite ? "重置邀请码" : "生成邀请码"}</button>
        {invite && <button className="ws-btn" disabled={busy} onClick={() => act(() => api(`${url}/invite`, { method: "DELETE" }), "邀请码已停用")}>停用邀请码</button>}
      </div>
      <h4>待审核申请（{requests.length}）</h4>
      {requests.length === 0 && <p className="ws-team-note">暂无加入申请</p>}
      {requests.map((r) => <div className="ws-management-card" key={r.id}><div><b>{r.displayName}</b><p>{r.email}</p></div><div className="ws-management-actions"><button className="ws-btn primary" disabled={busy} onClick={() => act(() => api(`${url}/join-requests`, { method: "PUT", json: { requestId: r.id, approve: true } }), "已同意加入")}>同意</button><button className="ws-btn" disabled={busy} onClick={() => act(() => api(`${url}/join-requests`, { method: "PUT", json: { requestId: r.id, approve: false } }), "已拒绝申请")}>拒绝</button></div></div>)}
    </> : <>
      <p className="ws-team-note">输入负责人提供的邀请码，提交申请后等待审核。</p><div className="ws-report-controls"><input className="ws-input" aria-label="团队邀请码" maxLength={16} placeholder="16 位邀请码" disabled={busy} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /><button className="ws-btn primary" disabled={busy || !code.trim()} onClick={() => act(() => api(`${url}/join`, { method: "POST", json: { code } }), "申请已提交，等待团队审核")}>申请加入</button></div>
      {requests.map((r) => <p className="ws-team-note" key={r.id}>{r.teamName} · {r.status === "approved" ? "审核通过" : r.status === "rejected" ? "已拒绝，可使用有效邀请码重新申请" : "等待审核"}</p>)}
    </>}
    {error && <p className="ws-error" role="alert">{error}<button className="ws-btn" disabled={busy} onClick={() => load().then(() => setError("")).catch((e: Error) => setError(e.message))}>刷新</button></p>}
    {notice && <p className="ws-team-note" role="status">{notice}</p>}
    {reset && <Modal title="重置邀请码" onClose={busy ? () => {} : () => setReset(false)}><p>重置后旧邀请码立即失效，已提交的加入申请会保留。</p><div className="ws-modal-actions"><button className="ws-btn" disabled={busy} onClick={() => setReset(false)}>取消</button><button className="ws-btn primary" disabled={busy} onClick={() => act(() => api(`${url}/invite`, { method: "POST" }), "邀请码已重置")}>确认重置</button></div>{error && <p className="ws-error">{error}</p>}</Modal>}
  </section>;
}
