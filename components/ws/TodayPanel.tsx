"use client";

// 「今日」首页（飞书式）：一屏回答“今天该干什么”——
// 截止提醒 / 进行中待办 / 未读私信 / 最近文档 四张卡片，点击直达对应内容
import { useEffect, useState } from "react";
import { api, dayKey, dueInfo, type DocSummary, type TaskItem } from "@/lib/api-client";
import type { WeeklyReport } from "@/lib/home-report";
import { useWorkspace, Icon, Avatar, Modal } from "./shared";
import { DailyReportCard } from "./DailyReportCard";
import { HomeCalendar } from "./HomeCalendar";

// 与 dueOn（东八区日期串）、后端日报口径一致：统一用 Asia/Hong_Kong 当天
const dayKeyToday = () => {
  const d = new Date();
  const today = dayKey(d.toISOString());
  const tomorrow = dayKey(new Date(d.getTime() + 86400000).toISOString());
  return { today, tomorrow };
};

export function TodayPanel() {
  const ws = useWorkspace();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  useEffect(() => {
    api<{ docs: DocSummary[] }>("/api/docs")
      .then((d) => setDocs(d.docs.slice(0, 3)))
      .catch(() => setDocs([]));
  }, []);

  const { today, tomorrow } = dayKeyToday();
  const deadlines = ws.myTasks
    .filter((t) => t.status !== "done" && (t.dueOn === today || t.dueOn === tomorrow))
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const doing = ws.myTasks.filter((t) => t.status === "doing").slice(0, 5);
  const unreadDms = ws.dmConversations.filter((c) => c.unreadCount > 0 && !c.muted).slice(0, 3);

  const openTask = (t: TaskItem) => {
    ws.selectProject(t.projectId);
    ws.setRailView("projects");
    ws.setFocusSection("tasks");
    ws.openTask(t.id);
  };

  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const dateText = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  // 任务进度（PDF 4.1：实时汇总任务待办 + 当前进度 + 截止日期）
  const ov = ws.overview;
  const taskPct = ov && ov.taskTotal > 0 ? Math.round((ov.taskDone / ov.taskTotal) * 100) : 0;

  // AI 周报：近 7 天聚合（与日报同源口径）
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  async function loadWeekly() {
    setWeeklyBusy(true);
    try {
      const d = await api<{ report: WeeklyReport }>("/api/home/weekly-report");
      setWeekly(d.report);
      setWeeklyOpen(true);
    } catch { /* 失败静默，按钮可重试 */ }
    finally { setWeeklyBusy(false); }
  }

  return (
    <div className="ws-today">
      <header className="ws-today-head">
        <div>
          <h1>{greeting}，{ws.me.name || ws.me.studentId}</h1>
          <p>{dateText} · {ws.overview ? `${ws.overview.myTodo + ws.overview.myDoing} 个待办 · ${ws.dmUnreadTotal} 条未读私信` : "正在加载…"}</p>
        </div>
        <button className="ws-btn" disabled={weeklyBusy} title="聚合近 7 天的项目动态、交付与消息" onClick={() => void loadWeekly()}>
          <Icon name="list" size={13} /> {weeklyBusy ? "生成中…" : "AI 周报"}
        </button>
      </header>

      {ov && (
        <div className="ws-today-progress" role="group" aria-label="任务进度">
          <span className="ws-progress-num">任务进度 {ov.taskDone}/{ov.taskTotal}（{taskPct}%）</span>
          <div className="ws-progress-track" aria-hidden>
            <div className={`ws-progress-fill ${taskPct >= 100 ? "full" : ""}`} style={{ width: `${taskPct}%` }} />
          </div>
          <span className="ws-progress-breakdown">待办 {ov.myTodo} · 进行中 {ov.myDoing} · 已完成 {ov.taskDone}</span>
        </div>
      )}

      <div className="ws-today-grid">
        <section className="ws-today-card">
          <h2><Icon name="flag" size={14} /> 截止临近 <span className="ws-count-pill">{deadlines.length}</span></h2>
          {deadlines.length === 0 && <div className="ws-empty" style={{ padding: 18 }}>今天和明天没有截止任务，节奏不错 👍</div>}
          {deadlines.map((t) => {
            const info = dueInfo(t.dueOn!);
            return (
              <button key={t.id} className="ws-today-item" onClick={() => openTask(t)}>
                <span className={`ws-pill due-${info.overdue ? "over" : info.soon ? "soon" : "norm"}`}>{info.text}</span>
                <span className="ws-today-item-main">
                  <b>{t.code}</b> {t.title}
                </span>
              </button>
            );
          })}
        </section>

        <section className="ws-today-card">
          <h2><Icon name="check" size={14} /> 进行中 <span className="ws-count-pill">{doing.length}</span></h2>
          {doing.length === 0 && <div className="ws-empty" style={{ padding: 18 }}>暂无进行中的任务，从待办里挑一个开始吧</div>}
          {doing.map((t) => (
            <button key={t.id} className="ws-today-item" onClick={() => openTask(t)}>
              <span className="ws-pill st-doing">进行中</span>
              <span className="ws-today-item-main"><b>{t.code}</b> {t.title}</span>
            </button>
          ))}
        </section>

        <section className="ws-today-card">
          <h2><Icon name="message" size={14} /> 未读私信 <span className="ws-count-pill">{ws.dmUnreadTotal}</span></h2>
          {unreadDms.length === 0 && <div className="ws-empty" style={{ padding: 18 }}>没有未读私信</div>}
          {unreadDms.map((c) => (
            <button key={c.id} className="ws-today-item" onClick={() => ws.openDmConversation(c.id)}>
              <Avatar name={c.partner.displayName} colorKey={c.partner.userId} size="sm" />
              <span className="ws-today-item-main">
                <b>{c.partner.displayName}</b>
                <small>{c.lastMessage?.content ?? "新消息"}</small>
              </span>
              {c.unreadCount > 0 && <span className="ws-dm-unread">{c.unreadCount}</span>}
            </button>
          ))}
        </section>

        <section className="ws-today-card">
          <h2><Icon name="book" size={14} /> 最近文档</h2>
          {docs === null && <div className="ws-empty" style={{ padding: 18 }}>正在加载…</div>}
          {docs?.length === 0 && <div className="ws-empty" style={{ padding: 18 }}>还没有文档，去云文档里新建一篇吧</div>}
          {docs?.map((d) => (
            <button key={d.id} className="ws-today-item" onClick={() => ws.openDoc(d.id)}>
              <Icon name="book" size={13} />
              <span className="ws-today-item-main">
                <b>{d.title}</b>
                <small>{d.projectName} · {d.updatedByName ?? "—"}</small>
              </span>
            </button>
          ))}
        </section>
      </div>

      {/* AI 日报 + 日历（PDF 4.2 / 计划项「日历」） */}
      <div className="ws-today-grid2">
        <DailyReportCard />
        <HomeCalendar />
      </div>

      {weeklyOpen && weekly && (
        <Modal title={`AI 周报 · ${weekly.headline.slice(0, 18)}…`} onClose={() => setWeeklyOpen(false)}>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ fontWeight: 600, margin: "0 0 8px" }}>{weekly.headline}</p>
            <p style={{ margin: "0 0 14px", opacity: 0.85 }}>{weekly.summary}</p>
            {weekly.lines.map((line, i) => (
              <p key={i} style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{line}</p>
            ))}
            <div style={{ marginTop: 14, borderTop: "1px dashed var(--ws-color-262a38, #2a2f45)", paddingTop: 10 }}>
              {weekly.nextWeekFocus.map((f, i) => <p key={i} style={{ margin: "4px 0" }}>{f}</p>)}
            </div>
            <p style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>由本地规则引擎基于近 7 天数据生成，内容不出本机。</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
