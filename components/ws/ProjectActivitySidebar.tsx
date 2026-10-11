"use client";

import { useState } from "react";
import { api, daysUntil, type ActivityItem } from "@/lib/api-client";
import { useWorkspace, Icon } from "./shared";

type SidebarMode = "compact" | "expanded" | "collapsed";

export function ProjectActivitySidebar() {
  const ws = useWorkspace();
  const [mode, setMode] = useState<SidebarMode>("compact");
  return (
    <aside className={`ws-activity-sidebar ${mode}`} aria-label="项目进度与日志">
      {mode === "collapsed" ? (
        <button className="ws-activity-reopen" onClick={() => setMode("compact")} title="展开项目进度与日志" aria-expanded={false}>
          <Icon name="flag" size={16} /><span>进度与日志</span><span>‹</span>
        </button>
      ) : (
        <>
          <header className="ws-activity-header">
            <b>{mode === "compact" ? "项目速览" : "进度与日志"}</b>
            <div>
              <button onClick={() => setMode(mode === "compact" ? "expanded" : "compact")} aria-expanded={mode === "expanded"}>
                {mode === "compact" ? "完整展开" : "速览"}
              </button>
              <button title="收起整个侧边栏" aria-label="收起整个侧边栏" onClick={() => setMode("collapsed")}><Icon name="x" size={14} /></button>
            </div>
          </header>
          {ws.selectedId ? <ActivityContent key={ws.selectedId} compact={mode === "compact"} /> : <div className="ws-empty">选择项目查看进度与日志</div>}
        </>
      )}
    </aside>
  );
}

function ActivityContent({ compact }: { compact: boolean }) {
  const ws = useWorkspace();
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const detail = ws.detail;
  const sprint = detail?.sprints.find((s) => s.status === "active") ?? null;
  // 本轮进度：优先统计当前活跃迭代内的任务，否则统计整个项目
  const scoped = sprint ? ws.tasks.filter((t) => t.sprintId === sprint.id) : ws.tasks;
  const total = scoped.length;
  const done = scoped.filter((t) => t.status === "done").length;
  const doingCount = scoped.filter((t) => t.status === "doing").length;
  const todoCount = scoped.filter((t) => t.status === "todo").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const entries = [...new Map([...ws.activities, ...older].map((entry) => [entry.id, entry])).values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);
  async function loadOlder() {
    const last = entries.at(-1);
    if (!last || loading) return;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ limit: "30", beforeId: String(last.id) });
      const result = await api<{ activities: ActivityItem[] }>(`/api/projects/${ws.selectedId}/activities?${query}`);
      setOlder((items) => [...items, ...result.activities]);
      setHasMore(result.activities.length === 30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="ws-activity-content">
      {compact ? (
        <section className="ws-space-section">
          <div className="ws-space-title">{sprint ? sprint.name : "项目整体进度"}<b>{pct}%</b></div>
          <div className="ws-progress"><i style={{ width: `${pct}%` }} /></div>
          <div className="ws-sprint-meta"><span>{done} / {total} 已完成</span><span>{doingCount} 进行中</span></div>
          {sprint?.endsOn && <div className="ws-compact-deadline">{daysUntil(sprint.endsOn) >= 0 ? `距交付 ${daysUntil(sprint.endsOn)} 天` : "已逾期交付"}</div>}
        </section>
      ) : (
      <section className="ws-space-section">
        <div className="ws-space-title">
          本轮进度
          {sprint && (detail?.myRole === "owner" || detail?.myRole === "admin") && sprint.status === "active" && (
            <button className="ws-icon-btn" title="完成当前迭代" onClick={() => ws.completeSprint(sprint.id)}>✓</button>
          )}
        </div>
        {sprint ? (
          <>
            <div className="ws-sprint-head">
              <span className="ws-sprint-name-lg">{sprint.name}</span>
              {sprint.endsOn && (
                <span className="ws-sprint-countdown">
                  {daysUntil(sprint.endsOn) >= 0 ? `距交付还有 ${daysUntil(sprint.endsOn)} 天` : "已逾期交付"}
                </span>
              )}
            </div>
            {(sprint.startsOn || sprint.endsOn) && (
              <div className="ws-sprint-range">
                {[sprint.startsOn, sprint.endsOn].filter(Boolean).map(d => d!.slice(5).replace("-", ".")).join(" – ")}
              </div>
            )}
            <div className="ws-progress"><i style={{ width: `${pct}%` }} /></div>
            <div className="ws-sprint-meta">
              <span><b>{done}</b> / {total} 已完成</span>
              <span><b>{pct}%</b></span>
            </div>
            <div className="ws-stat-grid">
              <div className="ws-stat-cell"><b>{todoCount}</b><span>待开始</span></div>
              <div className="ws-stat-cell"><b>{doingCount}</b><span>进行中</span></div>
              <div className="ws-stat-cell"><b>{done}</b><span>已完成</span></div>
            </div>
          </>
        ) : (
          <>
            <div className="ws-sprint-head">
              <span className="ws-sprint-name-lg">未开启迭代</span>
            </div>
            <div className="ws-progress"><i style={{ width: `${pct}%` }} /></div>
            <div className="ws-sprint-meta"><span>{done} / {total} 项目任务已完成</span><b>{pct}%</b></div>
            <button className="ws-btn primary" style={{ marginTop: 12, padding: "7px 12px", fontSize: 12, width: "100%" }} onClick={() => ws.openModal({ type: "newSprint" })}>
              ＋ 创建迭代
            </button>
          </>
        )}
      </section>


      )}
      <section className="ws-space-section">
        <div className="ws-space-title">{compact ? "最新动态 · 3 条" : "项目日志"}</div>
        {entries.length === 0 && <div className="ws-empty">暂无动态</div>}
        {(compact ? entries.slice(0, 3) : entries).map((entry) => (
          <div key={entry.id} className="ws-activity">
            <div className="act-detail" title={compact ? entry.detail : undefined}>{entry.detail}</div>
            <div className="act-time">{new Date(entry.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
        {!compact && entries.length > 0 && hasMore && <button className="ws-view-all" disabled={loading} onClick={loadOlder}>{loading ? "加载中…" : "加载更早日志"}</button>}
        {!compact && !hasMore && <div className="act-time">已显示全部日志</div>}
        {!compact && error && <div className="ws-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
