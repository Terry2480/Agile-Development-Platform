"use client";

import { useState } from "react";
import { useWorkspace } from "./shared";
import { DeleteWorkspaceModal, type DeleteTarget } from "./DeleteWorkspaceModal";
import { TeamPanel } from "./TeamPanel";
import { TeamInvitations } from "./TeamInvitations";

export function ManagementPanel({ kind }: { kind: "project" | "team" }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const isTeam = kind === "team";
  const items = (isTeam ? ws.teams : ws.projects).filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  const selectedTeam = ws.teams.find((t) => t.id === teamId);
  return <section className="ws-management">
    <div className="ws-panel-head"><h2>{isTeam ? "团队管理" : "项目管理"}<span className="ws-count-pill">{isTeam ? ws.teams.length : ws.projects.length}</span></h2>
      <button className="ws-btn primary" onClick={() => ws.openModal({ type: isTeam ? "newTeam" : "newProject" })}>＋ {isTeam ? "创建团队" : "创建项目"}</button></div>
    <p className="ws-team-note">{isTeam ? "统一查看团队、管理成员与分工。" : "在这里创建、查看和删除课程项目。"}</p>
    {isTeam && <TeamInvitations />}
    <input className="ws-input" aria-label={isTeam ? "搜索团队" : "搜索项目"} placeholder={isTeam ? "搜索团队…" : "搜索项目…"} value={query} onChange={(e) => setQuery(e.target.value)} />
    {notice && <p role="status">{notice}</p>}
    <div className="ws-management-list">
      {items.length === 0 && <div className="ws-empty">{query ? "没有匹配的结果" : isTeam ? "还没有团队，点击上方创建团队。" : "还没有项目，点击上方创建项目。"}</div>}
      {items.map((item) => {
        const project = !isTeam ? ws.projects.find((p) => p.id === item.id) : null;
        const team = isTeam ? ws.teams.find((t) => t.id === item.id) : ws.teams.find((t) => t.id === project?.teamId);
        const canDelete = isTeam ? team?.role === "owner" : team?.role === "owner" || team?.role === "admin";
        return <article className="ws-management-card" key={item.id}><div><h3>{item.name}</h3><p>{item.description || "暂无简介"}</p><small>{isTeam ? `${team?.memberCount ?? 0} 位成员 · ${team?.projectCount ?? 0} 个项目` : `${project?.teamName} · ${project?.taskCounts.total ?? 0} 个任务`}</small></div>
          <div className="ws-management-actions"><button className="ws-btn" onClick={() => { if (isTeam) setTeamId(item.id); else { ws.selectProject(item.id); ws.setFocusSection("tasks"); ws.setRailView("projects"); } }}>{isTeam ? "管理成员" : "进入项目"}</button>
            {canDelete && <button className="ws-btn danger" onClick={() => setTarget({ kind, id: item.id, name: item.name })}>{isTeam ? "解散团队" : "删除项目"}</button>}</div></article>;
      })}
    </div>
    {selectedTeam && <TeamPanel key={selectedTeam.id} teamId={selectedTeam.id} />}
    {target && <DeleteWorkspaceModal target={target} onClose={() => setTarget(null)} onDeleted={() => { setNotice(`${target.name} 已${isTeam ? "解散" : "删除"}`); setTarget(null); }} />}
  </section>;
}
