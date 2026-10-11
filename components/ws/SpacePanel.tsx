"use client";

// 项目空间栏：本轮进度（Sprint）、项目日志、项目成员、项目文件
import { useRef, useState } from "react";
import { fmtSize, daysUntil } from "@/lib/api-client";
import { useWorkspace, Icon, Modal } from "./shared";



export function SpacePanel() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.selectedId);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project) {
    return (
      <aside className="ws-space">
        <div className="ws-empty">选择项目查看概览</div>
      </aside>
    );
  }

  const detail = ws.detail;
  const sprint = detail?.sprints.find((s) => s.status === "active") ?? null;
  // 本轮进度：优先统计当前活跃迭代内的任务，否则统计整个项目
  const scoped = sprint ? ws.tasks.filter((t) => t.sprintId === sprint.id) : ws.tasks;
  const total = scoped.length;
  const done = scoped.filter((t) => t.status === "done").length;
  const doingCount = scoped.filter((t) => t.status === "doing").length;
  const todoCount = scoped.filter((t) => t.status === "todo").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <aside className="ws-space">
      {/* 本轮进度（迭代详情卡片） */}
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
            <div className="ws-progress"><i style={{ width: "0%" }} /></div>
            <div className="ws-sprint-meta"><span>{total} 个任务未规划迭代</span></div>
            <button className="ws-btn primary" style={{ marginTop: 12, padding: "7px 12px", fontSize: 12, width: "100%" }} onClick={() => ws.openModal({ type: "newSprint" })}>
              ＋ 创建迭代
            </button>
          </>
        )}
      </section>

      {/* 项目日志 */}
      <section className="ws-space-section">
        <div className="ws-space-title">项目日志</div>
        {ws.activities.length === 0 && <div className="ws-empty" style={{ padding: "16px 12px" }}>暂无动态</div>}
        {ws.activities.slice(0, 12).map((a) => (
          <div key={a.id} className="ws-activity">
            <div className="act-detail">{a.detail}</div>
            <div className="act-time">
              {new Date(a.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </section>

      {/* 项目文件库 */}
      <section className="ws-space-section">
        <div className="ws-space-title">
          项目文件库（{ws.files.length}）
          <button className="ws-icon-btn" title="上传文件" onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {ws.files.length === 0 && <div className="ws-empty" style={{ padding: "16px 12px" }}>暂无文件</div>}
        {ws.files.map((f) => (
          <a key={f.id} className="ws-file-item" href={`/api/files/${f.id}`}>
            <span className="ws-file-ic" style={{ color: "#6f9bff" }}><Icon name="file" size={13} /></span>
            <span className="ws-file-meta">
              <span className="ws-file-name" title={f.originalName}>{f.originalName}</span>
              <span className="ws-file-sub">{fmtSize(f.size)} · {f.uploaderName || f.uploaderStudentId}</span>
            </span>
          </a>
        ))}
        <input
          ref={fileRef} type="file" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              await ws.uploadProjectFile(file);
            } catch {
              /* 错误已在 store 提示 */
            }
            e.target.value = "";
          }}
        />
      </section>
    </aside>
  );
}

/* ---------- 新建迭代弹窗 ---------- */
export function NewSprintModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const nextNo = (ws.detail?.sprints.length ?? 0) + 1;
  const [name, setName] = useState(`SPRINT ${String(nextNo).padStart(2, "0")}`);
  const [goal, setGoal] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return setError("请填写迭代名称");
    setBusy(true);
    try {
      await ws.createSprint({
        name: name.trim(),
        goal: goal.trim() || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        status: activate ? "active" : "planned",
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="创建迭代" onClose={onClose}>
      <div className="ws-field">
        <label>名称</label>
        <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ws-field">
        <label>迭代目标（可选）</label>
        <input className="ws-input" placeholder="这轮要交付什么？" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="ws-field">
          <label>开始日期</label>
          <input className="ws-input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="ws-field">
          <label>交付日期</label>
          <input className="ws-input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#9aa1b5", cursor: "pointer" }}>
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        立即启动（将自动停用其他进行中的迭代）
      </label>
      {error && <div className="ws-error">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy} onClick={submit}>{busy ? "创建中…" : "创建迭代"}</button>
      </div>
    </Modal>
  );
}

/* ---------- 邀请成员弹窗 ---------- */
export function InviteModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim()) return setError("请填写对方邮箱");
    setBusy(true);
    try {
      await ws.inviteMember(email.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="邀请成员加入团队" onClose={onClose}>
      <div className="ws-field">
        <label>对方注册邮箱</label>
        <input className="ws-input" autoFocus placeholder="teammate@stu.edu.cn" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p style={{ fontSize: 11, color: "#5d6273", margin: "6px 0 0", lineHeight: 1.7 }}>
          对方需先用该邮箱注册 AgileCampus 账号；加入团队后自动进入团队的全部项目。
        </p>
      </div>
      {error && <div className="ws-error">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy} onClick={submit}>{busy ? "邀请中…" : "发送邀请"}</button>
      </div>
    </Modal>
  );
}
