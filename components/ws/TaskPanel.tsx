"use client";

// 主内容区：项目任务面板（状态分组 / Tab / 筛选 / 新建）、我的待办视图、通知视图、任务详情抽屉
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequestGate } from "@/lib/request-gate";
import {
  api, uploadFile as apiUpload, type TaskItem, type ProjectDetail,
  STATUS_TEXT, PRIORITY_TEXT, dueInfo, fmtSize, fmtDateShort, fmtTime,
} from "@/lib/api-client";
import { useWorkspace, Icon, Avatar, Modal } from "./shared";
import { displayNameOf, renderMentions } from "./helpers";

// 优先级竖条：蓝白黑三色系统（高=亮蓝 / 中=品牌蓝 / 低=灰蓝）
const PRIO_COLOR: Record<string, string> = { high: "#9cc0ff", medium: "#3b6ef5", low: "#46506b" };
const GROUPS: { status: TaskItem["status"]; label: string }[] = [
  { status: "doing", label: "进行中" },
  { status: "todo", label: "待开始" },
  { status: "done", label: "已完成" },
];

export function TaskPanel() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [showFilter, setShowFilter] = useState(false);
  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const project = ws.projects.find((p) => p.id === ws.selectedId);

  const filtered = useMemo(() => {
    const q = ws.taskSearch.trim().toLowerCase();
    return ws.tasks.filter((t) => {
      if (tab === "mine" && t.assigneeId !== ws.me.id) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fPriority && t.priority !== fPriority) return false;
      if (fAssignee && String(t.assigneeId ?? "") !== fAssignee) return false;
      if (fLabel && !t.labels.some((l) => String(l.id) === fLabel)) return false;
      if (q && !(t.title.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [ws.tasks, ws.taskSearch, tab, fStatus, fPriority, fAssignee, fLabel, ws.me.id]);

  if (!project) {
    return (
      <div>
        <div className="ws-empty" style={{ marginTop: 40 }}>
          {ws.projects.length === 0
            ? "还没有项目 —— 点击左侧「＋」创建你的第一个项目"
            : "在左侧选择一个项目开始协作"}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ws-panel-head">
        <h2>
          项目任务 <span className="ws-count-pill">{project.taskCounts.total}</span>
          <span className="ws-tabs">
            <button className={`ws-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>全部</button>
            <button className={`ws-tab ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}>我的任务</button>
          </span>
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="ws-btn" style={{ padding: "7px 12px", fontSize: 12 }} onClick={() => setShowFilter((v) => !v)}>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="filter" size={12} /> 筛选</span>
          </button>
          <button className="ws-btn primary" style={{ padding: "7px 13px", fontSize: 12 }} onClick={() => ws.openModal({ type: "newTask" })}>
            ＋ 新建任务
          </button>
        </div>
      </div>

      {showFilter && (
        <div className="ws-filter-row">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="todo">待开始</option>
            <option value="doing">进行中</option>
            <option value="done">已完成</option>
          </select>
          <select value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
            <option value="">全部优先级</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
            <option value="">全部负责人</option>
            <option value="">未分配</option>
            {ws.detail?.members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.displayName}</option>
            ))}
          </select>
          {ws.detail && ws.detail.labels.length > 0 && (
            <select value={fLabel} onChange={(e) => setFLabel(e.target.value)}>
              <option value="">全部标签</option>
              {ws.detail.labels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="ws-empty" style={{ marginTop: 10 }}>
          没有匹配的任务 —— 调整筛选条件，或 <b>＋ 新建任务</b>
        </div>
      )}

      {GROUPS.map(({ status, label }) => {
        const items = filtered.filter((t) => t.status === status);
        if (items.length === 0) return null;
        const open = expanded[status] ?? status === "doing";
        const shown = open ? items : items.slice(0, 3);
        return (
          <section key={status}>
            <div className="ws-group-head">
              {status === "done" && <span className="done-ic">✓</span>}
              {label} <span className="ws-count-pill">{items.length}</span>
            </div>
            {shown.map((t) => <TaskCard key={t.id} task={t} />)}
            {!open && items.length > 3 && (
              <button className="ws-view-all" onClick={() => setExpanded((s) => ({ ...s, [status]: true }))}>
                查看全部 {items.length} 个任务
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function TaskCard({ task: t, showProject }: { task: TaskItem; showProject?: boolean }) {
  const ws = useWorkspace();
  const due = t.dueOn ? dueInfo(t.dueOn) : null;
  const dueCls = due ? (due.overdue ? "due-over" : due.soon ? "due-soon" : "due-norm") : "";
  return (
    <div className="ws-task-card" onClick={() => ws.openTask(t.id)}>
      <button
        className={`ws-check ${t.status === "done" ? "done" : ""}`}
        title={t.status === "done" ? "标记为进行中" : "标记为已完成"}
        onClick={(e) => {
          e.stopPropagation();
          ws.updateTask(t.id, { status: t.status === "done" ? "doing" : "done" });
        }}
      >
        ✓
      </button>
      <span className="ws-prio-bar" style={{ background: PRIO_COLOR[t.priority] }} />
      <span className="ws-task-main">
        <span className="ws-task-code">{t.code}{showProject ? ` · ${t.projectName}` : ""}</span>
        <span className={`ws-task-title ${t.status === "done" ? "done" : ""}`}>{t.title}</span>
        <span className="ws-task-meta">
          <span className={`ws-pill pr-${t.priority}`}>{PRIORITY_TEXT[t.priority]}优先级</span>
          {t.labels.map((l) => (
            <span key={l.id} className="ws-pill" style={{ background: `${l.color}26`, color: l.color }}>{l.name}</span>
          ))}
        </span>
      </span>
      <span className="ws-task-right">
        {due && <span className={`ws-pill ${dueCls}`}>{due.text}</span>}
        <span className="ws-task-nums">
          {t.commentCount > 0 && <span title={`${t.commentCount} 条评论`}><Icon name="message" size={12} /> {t.commentCount}</span>}
          {t.attachmentCount > 0 && <span title={`${t.attachmentCount} 个附件`}><Icon name="paperclip" size={12} /> {t.attachmentCount}</span>}
        </span>
        {t.assignee ? (
          <Avatar name={t.assignee.displayName} colorKey={t.assignee.id ?? t.assignee.displayName} size="sm" title={t.assignee.displayName} />
        ) : (
          <span className="ws-avatar sm" style={{ background: "#232636", color: "#5d6273" }} title="未分配">?</span>
        )}
      </span>
    </div>
  );
}

/* ---------- 我的待办视图（图标栏「待办」） ---------- */
export function TodosView() {
  const ws = useWorkspace();
  return (
    <div>
      <div className="ws-panel-head">
        <h2>
          我的待办 <span className="ws-count-pill">{ws.myTasks.filter((t) => t.status !== "done").length} 项未完成</span>
        </h2>
      </div>
      {ws.myTasks.length === 0 && <div className="ws-empty">太棒了，当前没有指派给你的任务 🎉</div>}
      {GROUPS.map(({ status, label }) => {
        const items = ws.myTasks.filter((t) => t.status === status && t.title.toLowerCase().includes(ws.taskSearch.trim().toLowerCase()));
        if (items.length === 0) return null;
        return (
          <section key={status}>
            <div className="ws-group-head">
              {status === "done" && <span className="done-ic">✓</span>}
              {label} <span className="ws-count-pill">{items.length}</span>
            </div>
            {items.map((t) => <TaskCard key={t.id} task={t} showProject />)}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- 通知视图（图标栏「通知」） ---------- */
export function NotificationsView() {
  const ws = useWorkspace();
  return (
    <div>
      <div className="ws-panel-head">
        <h2>通知中心 <span className="ws-count-pill">{ws.unreadCount} 未读</span></h2>
        {ws.unreadCount > 0 && (
          <button className="ws-btn" onClick={() => ws.markRead()}>全部已读</button>
        )}
      </div>
      {ws.notifications.length === 0 && <div className="ws-empty">暂无通知</div>}
      <div style={{ background: "#16181f", border: "1px solid #262a38", borderRadius: 12, overflow: "hidden" }}>
        {ws.notifications.map((n) => (
          <div
            key={n.id}
            className={`ws-notif ${n.read ? "" : "unread"}`}
            style={{ borderRight: 0, borderLeft: 0, borderTop: 0 }}
            onClick={() => ws.markRead([n.id])}
          >
            <span className="n-ic" style={{ color: n.read ? "#5d6273" : "#6f9bff" }}>
              <Icon name={n.type === "assigned" ? "flag" : n.type === "mention" ? "at" : "message"} size={15} />
            </span>
            <div style={{ flex: 1 }}>
              {n.title}
              <span className="n-time">{new Date(n.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 任务详情抽屉 ---------- */
type TaskFull = {
  id: number; code: string; title: string; description: string | null;
  status: string; priority: string; dueOn: string | null; sprintId: number | null;
  assignee: { id: number; displayName: string } | null;
  creator: { displayName: string } | null;
  sprint: { id: number; name: string } | null;
  labels: { id: number; name: string; color: string }[];
  comments: { id: number; content: string; createdAt: string; authorId: number; authorDisplayName: string }[];
  subtasks: { id: number; code: string; title: string; status: string }[];
  files: { id: number; originalName: string; size: number }[];
  activities: { id: number; detail: string; createdAt: string; actorDisplayName: string }[];
};

export function TaskDrawer() {
  const ws = useWorkspace();
  const [task, setTask] = useState<TaskFull | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const id = ws.drawerTaskId;
  const [gate] = useState(() => new RequestGate());

  const load = useCallback(async () => {
    if (!id) return;
    const request = gate.begin("task");
    try {
      const data = await api<{ task: TaskFull }>(`/api/tasks/${id}`, { signal: request.signal });
      if (!request.current()) return;
      setError("");
      setTask(data.task);
    } catch (e) {
      if (!request.current()) return;
      setError((e as Error).message);
    }
  }, [id, gate]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; gate.cancel(); };
  }, [load, gate]);

  if (!id) return null;

  const detail: ProjectDetail | null = ws.detail;
  const memberNames = detail?.members.map((m) => m.displayName) ?? [];

  async function patch(fields: Record<string, unknown>) {
    try {
      await ws.updateTask(id!, fields);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitComment() {
    const content = comment.trim();
    if (!content) return;
    try {
      await api(`/api/tasks/${id}/comments`, { method: "POST", json: { content } });
      setComment("");
      await load();
      await ws.refreshTasks();
      await ws.refreshNotifications();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="ws-backdrop" style={{ zIndex: 55, background: "transparent" }} onClick={() => ws.closeTask()} />
      <aside className="ws-drawer">
        <div className="ws-drawer-head">
          <span className="d-code">{task?.code ?? "…"}</span>
          <button className="ws-icon-btn" onClick={() => ws.closeTask()}><Icon name="x" size={18} /></button>
        </div>

        <div className="ws-drawer-body">
          {error && <div className="ws-error" role="alert" style={{ marginTop: 0 }}>{error} <button className="ws-btn" onClick={() => void load()}>重试加载</button></div>}
          {!task ? (
            <div style={{ padding: 40, textAlign: "center", color: "#5d6273", fontSize: 13 }}>{error ? "任务加载失败" : "加载中…"}</div>
          ) : (
            <>
              <h2>{task.title}</h2>

              {task.description && <div className="ws-desc">{task.description}</div>}

              <div style={{ marginTop: 16 }}>
                <div className="ws-detail-row">
                  <label>状态</label>
                  <select className="ws-select" value={task.status} onChange={(e) => patch({ status: e.target.value })}>
                    {Object.entries(STATUS_TEXT).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
                <div className="ws-detail-row">
                  <label>优先级</label>
                  <select className="ws-select" value={task.priority} onChange={(e) => patch({ priority: e.target.value })}>
                    {Object.entries(PRIORITY_TEXT).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
                <div className="ws-detail-row">
                  <label>负责人</label>
                  <select
                    className="ws-select"
                    value={task.assignee?.id ?? ""}
                    onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">未分配</option>
                    {detail?.members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
                  </select>
                </div>
                <div className="ws-detail-row">
                  <label>截止日期</label>
                  <input className="ws-select" type="date" value={task.dueOn ?? ""} onChange={(e) => patch({ dueOn: e.target.value || null })} />
                </div>
                <div className="ws-detail-row">
                  <label>迭代</label>
                  <select
                    className="ws-select"
                    value={task.sprintId ?? ""}
                    onChange={(e) => patch({ sprintId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">未规划</option>
                    {detail?.sprints.filter((s) => s.status !== "completed").map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="ws-detail-row" style={{ alignItems: "flex-start" }}>
                  <label style={{ paddingTop: 6 }}>标签</label>
                  <span className="ws-chip-row">
                    {detail?.labels.map((l) => {
                      const on = task.labels.some((tl) => tl.id === l.id);
                      return (
                        <button
                          key={l.id}
                          className={`ws-chip ${on ? "on" : ""}`}
                          style={on ? { background: l.color } : {}}
                          onClick={() => {
                            const ids = task.labels.map((tl) => tl.id);
                            patch({ labelIds: on ? ids.filter((x) => x !== l.id) : [...ids, l.id] });
                          }}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                    {detail?.labels.length === 0 && <span style={{ fontSize: 12, color: "#5d6273" }}>团队暂无标签</span>}
                  </span>
                </div>
              </div>

              {task.files.length > 0 && (
                <>
                  <div className="ws-sub-title">附件（{task.files.length}）</div>
                  {task.files.map((f) => (
                    <a key={f.id} className="ws-file-item" href={`/api/files/${f.id}`}>
                      <span className="ws-file-ic"><Icon name="file" size={13} /></span>
                      <span className="ws-file-meta">
                        <span className="ws-file-name">{f.originalName}</span>
                        <span className="ws-file-sub">{fmtSize(f.size)}</span>
                      </span>
                      <Icon name="download" size={13} />
                    </a>
                  ))}
                </>
              )}

              <div className="ws-sub-title">评论（{task.comments.length}）</div>
              {task.comments.length === 0 && <div className="ws-empty" style={{ padding: "18px 14px" }}>还没有评论，说点什么…</div>}
              {task.comments.map((c) => (
                <div key={c.id} className="ws-comment">
                  <div className="c-head">
                    <Avatar name={c.authorDisplayName} colorKey={c.authorId} size="sm" />
                    <b>{c.authorDisplayName}</b>
                    <span>{fmtDateShort(c.createdAt)} {fmtTime(c.createdAt)}</span>
                  </div>
                  <div className="c-body">{renderMentions(c.content, memberNames)}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  className="ws-input"
                  placeholder="发表评论… @成员名 可提醒对方"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitComment()}
                />
                <button className="ws-btn primary" onClick={submitComment}>发送</button>
              </div>

              {task.activities.length > 0 && (
                <>
                  <div className="ws-sub-title">动态</div>
                  {task.activities.slice(0, 8).map((a) => (
                    <div key={a.id} className="ws-activity">
                      <div className="act-detail">{a.detail}</div>
                      <div className="act-time">{new Date(a.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  ))}
                </>
              )}

              <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#5d6273" }}>
                  {task.creator ? `由 ${task.creator.displayName} 创建` : ""}
                </span>
                <button
                  className="ws-btn"
                  onClick={async () => {
                    if (!confirm(`删除任务 ${task.code}？此操作不可恢复。`)) return;
                    try {
                      await api(`/api/tasks/${id}`, { method: "DELETE" });
                      ws.closeTask();
                      await ws.refreshTasks();
                      await ws.refreshProjects();
                      await ws.refreshActivities();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  删除任务
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid #22242f", display: "flex", gap: 8 }}>
          <button className="ws-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="paperclip" size={13} /> 上传附件</span>
          </button>
          <input
            ref={fileRef} type="file" hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await apiUpload(`/api/projects/${ws.selectedId}/files`, file, id);
                await load();
                await ws.refreshTasks();
                await ws.refreshFiles();
              } catch (err) {
                setError((err as Error).message);
              }
              e.target.value = "";
            }}
          />
        </div>
      </aside>
    </>
  );
}

/* ---------- 新建任务弹窗 ---------- */
export function NewTaskModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return setError("请填写任务标题");
    setBusy(true);
    try {
      await ws.createTask({
        projectId: ws.selectedId,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        assigneeId: assigneeId ? Number(assigneeId) : null,
        dueOn: dueOn || null,
        sprintId: sprintId ? Number(sprintId) : null,
        labelIds: labelIds.length ? labelIds : undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建任务" onClose={onClose}>
      <div className="ws-field">
        <label>标题</label>
        <input className="ws-input" autoFocus placeholder="要做什么？" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="ws-field">
        <label>描述（可选）</label>
        <textarea className="ws-textarea" placeholder="补充验收标准 / 备注…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="ws-field">
          <label>优先级</label>
          <select className="ws-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
          </select>
        </div>
        <div className="ws-field">
          <label>截止日期</label>
          <input className="ws-input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </div>
      </div>
      <div className="ws-field">
        <label>负责人</label>
        <select className="ws-select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">未分配</option>
          {ws.detail?.members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
        </select>
      </div>
      <div className="ws-field">
        <label>迭代</label>
        <select className="ws-select" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
          <option value="">未规划</option>
          {ws.detail?.sprints.filter((s) => s.status !== "completed").map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {ws.detail && ws.detail.labels.length > 0 && (
        <div className="ws-field">
          <label>标签</label>
          <span className="ws-chip-row">
            {ws.detail.labels.map((l) => {
              const on = labelIds.includes(l.id);
              return (
                <button
                  key={l.id} type="button"
                  className={`ws-chip ${on ? "on" : ""}`}
                  style={on ? { background: l.color } : {}}
                  onClick={() => setLabelIds((ids) => (on ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
                >
                  {l.name}
                </button>
              );
            })}
          </span>
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy} onClick={submit}>{busy ? "创建中…" : "创建任务"}</button>
      </div>
    </Modal>
  );
}
