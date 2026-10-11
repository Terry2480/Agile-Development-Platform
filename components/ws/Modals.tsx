"use client";

// 新建团队 / 新建项目弹窗
import { useState } from "react";
import { useWorkspace, Modal } from "./shared";

export function NewTeamModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return setError("请填写团队名称");
    setBusy(true);
    try {
      await ws.createTeam(name.trim(), description.trim() || undefined);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建团队" onClose={onClose}>
      <div className="ws-field">
        <label>团队名称</label>
        <input className="ws-input" autoFocus placeholder="如：敏捷校园研发组" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ws-field">
        <label>简介（可选）</label>
        <textarea className="ws-textarea" placeholder="团队是做什么的…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && <div className="ws-error">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy} onClick={submit}>{busy ? "创建中…" : "创建团队"}</button>
      </div>
    </Modal>
  );
}

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const availableTeams = ws.teams.filter((t) => t.role === "owner" || t.role === "admin");
  const [teamId, setTeamId] = useState<string>(availableTeams[0] ? String(availableTeams[0].id) : "");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!teamId) return setError("请选择团队（还没有团队请先新建团队）");
    if (!name.trim()) return setError("请填写项目名称");
    const upperKey = key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(upperKey)) return setError("项目标识需 2-6 位大写字母/数字（如 WEB、AGI）");
    setBusy(true);
    try {
      await ws.createProject(Number(teamId), name.trim(), upperKey, description.trim() || undefined);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建项目" onClose={onClose}>
      <div className="ws-field">
        <label>所属团队</label>
        <select className="ws-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {availableTeams.length === 0 && <option value="">（请先创建团队或联系团队管理员）</option>}
          {availableTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 12 }}>
        <div className="ws-field">
          <label>项目名称</label>
          <input className="ws-input" autoFocus placeholder="如：交互设计课程网站" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="ws-field">
          <label>标识</label>
          <input className="ws-input" placeholder="WEB" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} style={{ textTransform: "uppercase" }} />
        </div>
      </div>
      <div className="ws-field">
        <label>描述（可选）</label>
        <textarea className="ws-textarea" placeholder="项目简介…" value={description} onChange={(e) => setDescription(e.target.value)} />
        <p style={{ fontSize: 11, color: "#5d6273", margin: "6px 0 0" }}>
          标识用于生成任务编号（如 {key.trim().toUpperCase() || "WEB"}-001），团队内不可重复。团队全员将自动加入本项目。
        </p>
      </div>
      {error && <div className="ws-error">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy} onClick={submit}>{busy ? "创建中…" : "创建项目"}</button>
      </div>
    </Modal>
  );
}
