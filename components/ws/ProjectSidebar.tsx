"use client";

// 项目列表栏：搜索、我的工作空间/已收藏分组、选中项目子导航、底部 Sprint 卡
import { useMemo, useState } from "react";
import { avatarColor, daysUntil } from "@/lib/api-client";
import { useWorkspace, Icon, type FocusSection } from "./shared";


export function ProjectSidebar() {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(() => new Set());
  const toggleProject = (id: number) => setExpandedProjects((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ws.projects.filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) : ws.projects;
  }, [ws.projects, query]);

  const starred = filtered.filter((p) => p.starred);
  const mine = filtered.filter((p) => !p.starred);
  const selected = ws.projects.find((p) => p.id === ws.selectedId) ?? null;

  return (
    <aside className="ws-sidebar">
      <div className="ws-side-head">
        <b>项目</b>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="ws-icon-btn" title="收起全部项目" aria-label="收起全部项目" onClick={() => setExpandedProjects(new Set())}>
            <Icon name="collapse" size={15} />
          </button>


        </div>
      </div>

      <div className="ws-search">
        <Icon name="search" size={13} />
        <input placeholder="查找项目…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="ws-side-scroll">
        {starred.length > 0 && (
          <>
            <div className="ws-group-label">已收藏</div>
            {starred.map((p) => (
              <ProjectItem key={p.id} id={p.id} expanded={expandedProjects.has(p.id)} onToggle={() => toggleProject(p.id)} />
            ))}
          </>
        )}
        <div className="ws-group-label">我的工作空间</div>
        {mine.length === 0 && starred.length === 0 && (
          <div style={{ padding: "18px 10px", fontSize: 12, color: "var(--ws-color-5d6273)", lineHeight: 1.8 }}>
            还没有项目，请前往最左侧「项目管理」创建项目。
          </div>
        )}
        {mine.map((p) => (
          <ProjectItem key={p.id} id={p.id} expanded={expandedProjects.has(p.id)} onToggle={() => toggleProject(p.id)} />
        ))}
      </div>

      <SprintCard />
      {selected && <div style={{ height: 6 }} />}

    </aside>
  );
}

function ProjectItem({ id, expanded, onToggle }: {
  id: number; expanded: boolean; onToggle(): void;
}) {
  const ws = useWorkspace();
  const p = ws.projects.find((x) => x.id === id)!;
  const active = ws.selectedId === id && ws.railView === "projects";
  const color = avatarColor(p.key);
  function openSection(section: FocusSection) {
    ws.setRailView("projects");
    ws.selectProject(id);
    ws.setFocusSection(section);
  }

  return (
    <div>
      <div
        className={`ws-proj ${active ? "active" : ""}`}
        onClick={() => {
          ws.setRailView("projects");
          ws.selectProject(id);
        }}
      >
        <button className="ws-project-toggle" aria-expanded={expanded} aria-controls={`project-sections-${id}`}
          aria-label={`${expanded ? "收起" : "展开"}项目 ${p.name}`} title={expanded ? "收起子菜单" : "展开子菜单"}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={13} />
        </button>
        <span className="ws-proj-icon" style={{ background: `${color}2e`, color }}>{p.key.slice(0, 1)}</span>
        <span className="ws-proj-meta">
          <span className="ws-proj-name">{p.name}</span>
          <span className="ws-proj-sub">
            {p.teamName} · {p.taskCounts.total} 任务
            <span className="ws-avatar-stack" style={{ display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
              {p.members.slice(0, 4).map((m) => (
                <span
                  key={m.userId}
                  className="ws-avatar"
                  style={{ width: 16, height: 16, fontSize: 8, borderRadius: 5, background: avatarColor(m.name) }}
                  title={m.name}
                >
                  {m.name.slice(0, 1)}
                </span>
              ))}
            </span>
          </span>
        </span>

        <button
          className={`ws-proj-star ${p.starred ? "on" : ""}`}
          title={p.starred ? "取消收藏" : "收藏项目"}
          onClick={(e) => {
            e.stopPropagation();
            ws.toggleStar(p.id);
          }}
        >
          <Icon name="star" size={13} />
        </button>
      </div>

      <div id={`project-sections-${id}`} className="ws-subnav" hidden={!expanded}>

          <button className={active && ws.focusSection === "chat" ? "active" : ""} onClick={() => openSection("chat")}>
            <Icon name="message" size={13} /> 团队聊天
          </button>
          <button className={active && ws.focusSection === "tasks" ? "active" : ""} onClick={() => openSection("tasks")}>
            <Icon name="grid" size={13} /> 项目任务
          </button>
          <button className={active && ws.focusSection === "space" ? "active" : ""} onClick={() => openSection("space")}>
            <Icon name="file" size={13} /> 项目概览
          </button>
        </div>
    </div>
  );
}

function SprintCard() {
  const ws = useWorkspace();
  const selected = ws.projects.find((p) => p.id === ws.selectedId);
  const sprint = selected?.activeSprint ?? null;

  if (!selected) {
    return (
      <div className="ws-sprint-card" style={{ opacity: 0.55 }}>
        <div className="ws-sprint-name">SPRINT</div>
        <div className="ws-sprint-goal">选择项目后查看迭代</div>
      </div>
    );
  }
  if (!sprint) {
    return (
      <div className="ws-sprint-card">
        <div className="ws-sprint-name">暂无进行中的迭代</div>
        <button
          className="ws-btn primary"
          style={{ marginTop: 10, padding: "7px 12px", fontSize: 12, width: "100%" }}
          onClick={() => ws.openModal({ type: "newSprint" })}
        >
          ＋ 创建迭代
        </button>
      </div>
    );
  }
  const days = sprint.endsOn ? daysUntil(sprint.endsOn) : null;
  return (
    <div className="ws-sprint-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div className="ws-sprint-name">{sprint.name}</div>
        <button className="ws-icon-btn" style={{ width: 22, height: 22 }} title="创建新迭代" onClick={() => ws.openModal({ type: "newSprint" })}>
          <Icon name="plus" size={13} />
        </button>
      </div>
      {sprint.goal && <div className="ws-sprint-goal">{sprint.goal}</div>}
      <div className="ws-sprint-days">
        {days === null ? "—" : days >= 0 ? days : 0}
        <small>{days === null ? "未设交付日" : days >= 0 ? `天后交付 · ${sprint.endsOn}` : `已逾期交付 · ${sprint.endsOn}`}</small>
      </div>
    </div>
  );
}
