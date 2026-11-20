"use client";
import { useState } from "react";
import { EMPTY_TASK_FILTERS, type TaskFilters } from "@/lib/task-filters";

export function TaskFilterBar({ value, onChange, onClear, searchActive, count, total, activeSprintAvailable, members, labels, projects }: {
  value: TaskFilters; onChange(filters: TaskFilters): void; count: number; total: number; activeSprintAvailable: boolean;
  members: { userId: number; displayName: string }[]; labels: { id: number; name: string }[];
  projects?: { id: number; name: string }[];
  onClear(): void; searchActive: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const update = (patch: Partial<TaskFilters>) => onChange({ ...value, ...patch });
  const active = searchActive || Object.entries(EMPTY_TASK_FILTERS).some(([key, empty]) => value[key as keyof TaskFilters] !== empty);
  return <div className="ws-task-filter-bar">
    <div className="ws-task-quick-filters" role="group" aria-label="任务快捷筛选">
      <button className={`ws-filter-chip ${value.relation === "assigned" ? "active" : ""}`} aria-pressed={value.relation === "assigned"} onClick={() => update({ relation: value.relation === "assigned" ? "all" : "assigned" })}>我负责的</button>
      <button className={`ws-filter-chip ${value.relation === "collaborating" ? "active" : ""}`} aria-pressed={value.relation === "collaborating"} onClick={() => update({ relation: value.relation === "collaborating" ? "all" : "collaborating" })}>我协作的</button>
      {(["today", "overdue"] as const).map((due) => <button key={due} className={`ws-filter-chip ${value.due === due ? "active" : ""}`} aria-pressed={value.due === due} onClick={() => update({ due: value.due === due ? "all" : due })}>{due === "today" ? "今天截止" : "已逾期"}</button>)}
      <button className={`ws-filter-chip ${value.activeSprint ? "active" : ""}`} disabled={!activeSprintAvailable && !value.activeSprint} title={activeSprintAvailable ? "只看进行中迭代的任务" : "暂无进行中的迭代"} aria-pressed={value.activeSprint} onClick={() => update({ activeSprint: !value.activeSprint })}>当前迭代</button>
      <button className="ws-btn" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>更多筛选</button>
      {active && <button className="ws-btn" onClick={() => { onChange({ ...EMPTY_TASK_FILTERS }); onClear(); }}>清除筛选</button>}
    </div>
    {advanced && <div className="ws-filter-row">
      <select className="ws-select" aria-label="按状态筛选" value={value.status} onChange={(e) => update({ status: e.target.value })}><option value="">全部状态</option><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select>
      <select className="ws-select" aria-label="按优先级筛选" value={value.priority} onChange={(e) => update({ priority: e.target.value })}><option value="">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select>
      <select className="ws-select" aria-label="按负责人筛选" value={value.assignee} onChange={(e) => update({ assignee: e.target.value })}><option value="">全部负责人</option><option value="unassigned">未分配负责人</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}</select>
      <select className="ws-select" aria-label="按截止日期筛选" value={value.due} onChange={(e) => update({ due: e.target.value as TaskFilters["due"] })}><option value="all">全部截止日期</option><option value="today">今天截止</option><option value="tomorrow">明天截止</option><option value="overdue">已逾期</option><option value="none">无截止日期</option></select>
      {labels.length > 0 && <select className="ws-select" aria-label="按标签筛选" value={value.label} onChange={(e) => update({ label: e.target.value })}><option value="">全部标签</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select>}
      {projects && <select className="ws-select" aria-label="按项目筛选" value={value.project} onChange={(e) => update({ project: e.target.value })}><option value="">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
    </div>}
    <p className="ws-task-filter-count" role="status">显示 {count} / {total} 个任务{active && !advanced ? " · 已应用筛选" : ""}</p>
  </div>;
}
