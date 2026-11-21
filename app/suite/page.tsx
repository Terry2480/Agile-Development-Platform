"use client";

// 个人效率中心 /suite —— 日历 / 待办 / 记事 三合一（对标 Google Calendar + Tasks + Keep）
// 独立页面，数据按用户隔离；日历聚合「项目任务截止 + 里程碑 + 个人待办截止日」。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, dayKey } from "@/lib/api-client";
import { monthDays, groupEventsByDate, prevMonth, nextMonth, type CalendarEvent } from "@/lib/calendar-events";
import { parseIcsEvents } from "@/lib/ics";
import "./suite.css";

type Tab = "calendar" | "todos" | "notes";
type Todo = { id: number; title: string; note: string | null; done: boolean; dueOn: string | null; createdAt: string };
type Note = { id: number; title: string; content: string; color: string; pinned: boolean; updatedAt: string };
const NOTE_COLORS = ["yellow", "blue", "green", "pink", "purple"] as const;
const localToday = () => dayKey(new Date().toISOString());

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "calendar", label: "日历", icon: "cal" },
  { key: "todos", label: "待办", icon: "check" },
  { key: "notes", label: "记事", icon: "note" },
];

function Svg({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    cal: "M3 5h18v16H3zM3 9h18M8 3v4M16 3v4",
    check: "M4 12l5 5L20 6",
    note: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
    plus: "M12 5v14M5 12h14",
    trash: "M3 6h18M8 6V4h8v2M6 6v14h12V6",
    pin: "M12 17v5M9 10a3 3 0 011-6h4a3 3 0 011 6l1 2H8z",
    back: "M19 12H5M12 19l-7-7 7-7",
    chevL: "M15 18l-6-6 6-6",
    chevR: "M9 18l6-6-6-6",
    home: "M3 9l9-7 9 7v11H3z",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{(paths[name] ?? "").split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}</svg>;
}

export default function SuitePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");

  // 待办
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDue, setTodoDue] = useState("");
  const [busyTodo, setBusyTodo] = useState(false);
  // 记事
  const [notes, setNotes] = useState<Note[]>([]);
  const [busyNote, setBusyNote] = useState(false);
  // 日历
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [selected, setSelected] = useState(localToday());

  useEffect(() => {
    api<{ user: { id: number } }>("/api/auth/me").then(() => setAuthed(true))
      .catch((e) => { setAuthed(false); if (e instanceof ApiError && e.status === 401) router.replace("/login"); });
  }, [router]);

  const loadTodos = useCallback(() => {
    api<{ todos: Todo[] }>("/api/suite/todos").then((d) => setTodos(d.todos)).catch(() => setTodos([]));
  }, []);
  const loadNotes = useCallback(() => {
    api<{ notes: Note[] }>("/api/suite/notes").then((d) => setNotes(d.notes)).catch(() => setNotes([]));
  }, []);
  const loadCalendar = useCallback(() => {
    Promise.all([
      api<{ events: CalendarEvent[] }>(`/api/home/calendar?month=${month}`).then((d) => d.events).catch(() => [] as CalendarEvent[]),
      api<{ todos: Todo[] }>("/api/suite/todos").then((d) => d.todos).catch(() => [] as Todo[]),
    ]).then(([projectEvents, myTodos]) => {
      const personal: CalendarEvent[] = myTodos
        .filter((t) => !t.done && t.dueOn && t.dueOn.startsWith(month))
        .map((t) => ({ date: t.dueOn!, kind: "task" as const, title: t.title, status: "todo", projectId: 0, projectName: "个人待办" }));
      setEvents([...projectEvents, ...personal].sort((a, b) => a.date.localeCompare(b.date)));
    });
  }, [month]);

  useEffect(() => { if (authed) { loadTodos(); loadNotes(); } }, [authed, loadTodos, loadNotes]);
  useEffect(() => { if (authed && tab === "calendar") loadCalendar(); }, [authed, tab, loadCalendar]);

  /* ---- 待办操作 ---- */
  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!todoTitle.trim()) return;
    setBusyTodo(true);
    try {
      await api("/api/suite/todos", { method: "POST", json: { title: todoTitle.trim(), dueOn: todoDue || null } });
      setTodoTitle(""); setTodoDue(""); loadTodos(); if (tab === "calendar") loadCalendar();
    } finally { setBusyTodo(false); }
  }
  async function toggleTodo(t: Todo) {
    setTodos((prev) => prev.map((x) => x.id === t.id ? { ...x, done: !x.done } : x));
    try { await api("/api/suite/todos", { method: "PUT", json: { id: t.id, done: !t.done } }); }
    catch { loadTodos(); }
    if (tab === "calendar") loadCalendar();
  }
  async function removeTodo(id: number) {
    setTodos((prev) => prev.filter((x) => x.id !== id));
    try { await api(`/api/suite/todos?id=${id}`, { method: "DELETE" }); }
    catch { loadTodos(); }
    if (tab === "calendar") loadCalendar();
  }

  /* ---- 日历导入（.ics）：把外部日历事件转入个人待办，截止日自动上日历 ---- */
  const icsRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState("");
  const [importing, setImporting] = useState(false);
  async function importIcs(file: File) {
    setImporting(true);
    setImportMsg("解析中…");
    try {
      const { events, skipped } = parseIcsEvents(await file.text());
      if (events.length === 0) { setImportMsg("没有解析到带日期的事件，请确认是日历导出的 .ics 文件"); return; }
      let ok = 0;
      for (const ev of events.slice(0, 200)) { // 课程场景上限，防误导入超大文件
        try {
          await api("/api/suite/todos", { method: "POST", json: { title: ev.title.slice(0, 200), dueOn: ev.dateKey, note: "来自日历导入" } });
          ok += 1;
        } catch { /* 单条失败不中断整体导入 */ }
      }
      setImportMsg(`已导入 ${ok} 条到待办${skipped ? `，跳过 ${skipped} 条（缺少日期）` : ""}`);
      loadTodos();
      if (tab === "calendar") loadCalendar();
    } catch (e) {
      setImportMsg(`导入失败：${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  /* ---- 记事操作 ---- */
  async function addNote() {
    setBusyNote(true);
    try {
      await api("/api/suite/notes", { method: "POST", json: { title: "", content: "", color: "yellow" } });
      loadNotes();
    } finally { setBusyNote(false); }
  }
  async function patchNote(n: Note, patch: Partial<Note>) {
    setNotes((prev) => prev.map((x) => x.id === n.id ? { ...x, ...patch } : x));
    try { await api("/api/suite/notes", { method: "PUT", json: { id: n.id, ...patch } }); }
    catch { loadNotes(); }
  }
  async function removeNote(id: number) {
    setNotes((prev) => prev.filter((x) => x.id !== id));
    try { await api(`/api/suite/notes?id=${id}`, { method: "DELETE" }); }
    catch { loadNotes(); }
  }

  /* ---- 日历渲染 ---- */
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return monthDays(y, m);
  }, [month]);
  const byDate = useMemo(() => groupEventsByDate(events ?? []), [events]);
  const [yearStr, monthStr] = month.split("-");
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const dayEvents = byDate[selected] ?? [];
  const today = localToday();

  if (authed === null) return <div className="su-wrap"><div className="su-loading">正在加载效率中心…</div></div>;
  if (!authed) return <div className="su-wrap"><div className="su-loading">正在前往登录页…</div></div>;

  return (
    <div className="su-wrap">
      <header className="su-head">
        <button className="su-icon-btn" title="返回工作台" onClick={() => router.push("/workspace")}><Svg name="back" /></button>
        <div className="su-brand"><span className="su-logo">A</span><div><b>效率中心</b><small>日历 · 待办 · 记事</small></div></div>
        <button className="su-icon-btn su-head-home" title="首页" onClick={() => router.push("/")}><Svg name="home" /></button>
      </header>

      <nav className="su-tabs" aria-label="效率中心功能">
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}><Svg name={t.icon} size={16} />{t.label}</button>)}
      </nav>

      <main className="su-main">
        {/* ============ 日历 ============ */}
        {tab === "calendar" && (
          <section className="su-panel">
            <div className="su-panel-head">
              <h1>日历</h1>
              <div className="su-month-nav">
                <button className="su-icon-btn" title="上个月" onClick={() => setMonth(prevMonth(month))}><Svg name="chevL" size={16} /></button>
                <b>{yearStr} 年 {Number(monthStr)} 月</b>
                <button className="su-icon-btn" title="下个月" onClick={() => setMonth(nextMonth(month))}><Svg name="chevR" size={16} /></button>
                <button className="su-today-btn" onClick={() => { setMonth(localToday().slice(0, 7)); setSelected(localToday()); }}>今天</button>
              </div>
            </div>
            <div className="su-cal-shell">
              <div className="su-cal">
                <div className="su-cal-week">{weekdays.map((w) => <span key={w}>{w}</span>)}</div>
                <div className="su-cal-grid">
                  {cells.map((c) => {
                    const evs = byDate[c.key] ?? [];
                    return (
                      <button key={c.key} className={["su-cal-day", c.inMonth ? "" : "out", c.key === today ? "today" : "", c.key === selected ? "selected" : ""].join(" ")} onClick={() => setSelected(c.key)}>
                        <span className="su-cal-num">{Number(c.key.slice(8, 10))}</span>
                        <span className="su-cal-dots">{evs.slice(0, 3).map((e, i) => <i key={i} className={e.projectId === 0 ? "personal" : e.kind === "milestone" ? "ms" : ""} />)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="su-cal-side">
                <h3>{selected === today ? "今天" : selected} 的安排{dayEvents.length > 0 && ` · ${dayEvents.length} 项`}</h3>
                {events === null && <p className="su-empty">加载中…</p>}
                {events !== null && dayEvents.length === 0 && <p className="su-empty">这一天没有安排</p>}
                {dayEvents.map((e, i) => (
                  <div key={i} className="su-cal-ev">
                    <span className={`su-tag ${e.projectId === 0 ? "personal" : e.kind === "milestone" ? "ms" : ""}`}>{e.projectId === 0 ? "个人" : e.kind === "milestone" ? "里程碑" : "任务"}</span>
                    <div><b>{e.code ? `${e.code} ` : ""}{e.title}</b><small>{e.projectName}</small></div>
                  </div>
                ))}
                <div className="su-cal-legend"><span><i className="personal" />个人待办</span><span><i className="ms" />里程碑</span><span><i />项目任务</span></div>
              </aside>
            </div>
          </section>
        )}

        {/* ============ 待办 ============ */}
        {tab === "todos" && (
          <section className="su-panel">
            <div className="su-panel-head">
              <h1>待办</h1><span className="su-count">{todos.filter((t) => !t.done).length} 项未完成</span>
              <button type="button" className="su-import" disabled={importing} onClick={() => icsRef.current?.click()} title="导入 Google 日历 / 手机系统日历导出的 .ics 文件">
                <Svg name="cal" size={14} />{importing ? "导入中…" : "导入日历 .ics"}
              </button>
              <input ref={icsRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importIcs(f); e.target.value = ""; }} />
            </div>
            {importMsg && <div className="su-import-msg" role="status">{importMsg}</div>}
            <form className="su-add" onSubmit={addTodo}>
              <input value={todoTitle} onChange={(e) => setTodoTitle(e.target.value)} placeholder="添加一项待办，回车即可…" aria-label="待办标题" />
              <input type="date" value={todoDue} onChange={(e) => setTodoDue(e.target.value)} aria-label="截止日期" />
              <button type="submit" className="su-primary" disabled={busyTodo || !todoTitle.trim()}><Svg name="plus" size={16} />添加</button>
            </form>
            <ul className="su-todo-list">
              {todos.length === 0 && <li className="su-empty-lg">还没有待办，在上面添加第一项吧</li>}
              {todos.map((t) => (
                <li key={t.id} className={t.done ? "done" : ""}>
                  <button className="su-check" onClick={() => toggleTodo(t)} aria-label={t.done ? "标记未完成" : "标记完成"}>{t.done && <Svg name="check" size={14} />}</button>
                  <div className="su-todo-body"><b>{t.title}</b>{t.dueOn && <small>截止 {t.dueOn}</small>}{t.note && <small>{t.note}</small>}</div>
                  <button className="su-icon-btn su-del" title="删除" onClick={() => removeTodo(t.id)}><Svg name="trash" size={15} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ============ 记事 ============ */}
        {tab === "notes" && (
          <section className="su-panel">
            <div className="su-panel-head"><h1>记事</h1><button className="su-primary" onClick={addNote} disabled={busyNote}><Svg name="plus" size={16} />新建记事</button></div>
            <div className="su-notes-grid">
              {notes.length === 0 && <div className="su-empty-lg">还没有记事，点「新建记事」随手记一条</div>}
              {notes.map((n) => (
                <article key={n.id} className={`su-note ${n.color}`}>
                  <div className="su-note-top">
                    <button className={`su-pin ${n.pinned ? "on" : ""}`} title={n.pinned ? "取消置顶" : "置顶"} onClick={() => patchNote(n, { pinned: !n.pinned })}><Svg name="pin" size={15} /></button>
                    <button className="su-icon-btn su-del" title="删除" onClick={() => removeNote(n.id)}><Svg name="trash" size={15} /></button>
                  </div>
                  <input className="su-note-title" value={n.title} placeholder="标题" onChange={(e) => patchNote(n, { title: e.target.value })} />
                  <textarea className="su-note-content" value={n.content} placeholder="写点什么…" onChange={(e) => patchNote(n, { content: e.target.value })} />
                  <div className="su-note-foot">
                    <div className="su-colors">{NOTE_COLORS.map((c) => <button key={c} className={`su-color ${c} ${n.color === c ? "on" : ""}`} title={c} onClick={() => patchNote(n, { color: c })} />)}</div>
                    <small>{new Date(n.updatedAt).toLocaleDateString("zh-CN")}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
