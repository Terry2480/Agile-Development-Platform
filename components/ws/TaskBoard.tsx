"use client";
import { useRef, useState } from "react";
import { dueInfo, PRIORITY_TEXT, STATUS_TEXT, type TaskItem } from "@/lib/api-client";
import { useWorkspace, Icon } from "./shared";
import { TaskParticipants } from "./TaskParticipants";

const COLUMNS = [
  { status: "todo", description: "准备开始的工作" },
  { status: "doing", description: "正在推进的工作" },
  { status: "done", description: "已确认完成的交付" },
] as const;

export function TaskBoard({ tasks }: { tasks: TaskItem[] }) {
  const ws = useWorkspace();
  const locked = useRef(new Set<number>());
  const [pending, setPending] = useState<number[]>([]);
  const [error, setError] = useState("");
  const done = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  async function move(task: TaskItem, status: TaskItem["status"]) {
    if (status === task.status || locked.current.has(task.id)) return;
    locked.current.add(task.id); setPending((ids) => [...ids, task.id]); setError("");
    try { await ws.updateTask(task.id, { status }); }
    catch (e) { setError(`“${task.title}”移动失败：${(e as Error).message}`); }
    finally { locked.current.delete(task.id); setPending((ids) => ids.filter((id) => id !== task.id)); }
  }
  return <div className="ws-task-board">
    <div className="ws-board-overview">
      <span>当前结果完成度 <b>{progress}%</b></span>
      <progress value={done} max={tasks.length || 1} aria-label="当前筛选结果完成比例" />
      <span>{done} / {tasks.length} 已完成</span>
    </div>
    {error && <div className="ws-error" role="alert">{error}</div>}
    <div className="ws-board-columns">
      {COLUMNS.map(({ status, description }) => {
        const items = tasks.filter((task) => task.status === status);
        return <section key={status} className={`ws-board-column ${status}`} aria-label={`${STATUS_TEXT[status]}，${items.length} 个任务`}>
          <header><div><h3><span className="ws-board-status-dot" />{STATUS_TEXT[status]}<span className="ws-count-pill">{items.length}</span></h3><p>{description}</p></div></header>
          <div className="ws-board-column-body">
            {items.length === 0 && <div className="ws-board-empty"><Icon name={status === "done" ? "check" : "grid"} size={22} /><span>暂无{STATUS_TEXT[status]}任务</span></div>}
            {items.map((task) => {
              const busy = pending.includes(task.id);
              const due = task.dueOn && status !== "done" ? dueInfo(task.dueOn) : null;
              return <article key={task.id} className={`ws-board-card ${busy ? "pending" : ""}`} onClick={() => { if (!busy) ws.openTask(task.id); }}>
                <div className="ws-board-card-head"><span>{task.code}</span>
                  <select className="ws-select ws-board-move" aria-label={`移动任务 ${task.title} 的状态`} value={status} disabled={busy}
                    onClick={(e) => e.stopPropagation()} onChange={(e) => void move(task, e.target.value as TaskItem["status"])}>
                    {COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.status === status ? STATUS_TEXT[column.status] : `移至${STATUS_TEXT[column.status]}`}</option>)}
                  </select>
                </div>
                <button className="ws-board-card-title" disabled={busy} aria-label={`查看任务 ${task.title}`}>{task.title}</button>
                <div className="ws-board-card-tags"><span className={`ws-pill pr-${task.priority}`}>{PRIORITY_TEXT[task.priority]}优先级</span>
                  {due && <span className={`ws-pill ${due.overdue ? "due-over" : due.soon ? "due-soon" : "due-norm"}`}>{due.text}</span>}
                  {task.labels.slice(0, 2).map((label) => <span key={label.id} className="ws-board-label" title={label.name}>{label.name}</span>)}
                  {task.labels.length > 2 && <span className="ws-board-label" title={task.labels.slice(2).map((label) => label.name).join("、")}>+{task.labels.length - 2}</span>}
                </div>
                <TaskParticipants assignee={task.assignee ? { id: task.assignee.id ?? task.assigneeId!, displayName: task.assignee.displayName } : null} collaborators={task.collaborators ?? []} />
                <footer>{busy ? <span role="status">正在移动…</span> : <span>点击查看详情</span>}<span>{[task.commentCount > 0 ? `${task.commentCount} 条评论` : "", task.attachmentCount > 0 ? `${task.attachmentCount} 个附件` : ""].filter(Boolean).join(" · ")}</span></footer>
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
