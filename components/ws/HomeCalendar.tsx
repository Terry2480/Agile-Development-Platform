"use client";

// 首页日历卡片：月历网格（周一起始）+ 任务截止/里程碑事件点，
// 点选日期查看当日安排；月份可前后切换；30 秒轮询保持实时。
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Icon } from "./shared";
import { monthDays, groupEventsByDate, prevMonth, nextMonth, type CalendarEvent } from "@/lib/calendar-events";

const localTodayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const localMonthKey = () => localTodayKey().slice(0, 7);

export function HomeCalendar() {
  const [month, setMonth] = useState(localMonthKey());
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [selected, setSelected] = useState<string>(localTodayKey());
  const [failed, setFailed] = useState("");

  const load = useCallback(() => {
    api<{ month: string; events: CalendarEvent[] }>(`/api/home/calendar?month=${month}`)
      .then((d) => { setEvents(d.events); setFailed(""); })
      .catch((e: Error) => setFailed(e.message));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const cells = monthDays(...(month.split("-").map(Number) as [number, number]));
  const byDate = groupEventsByDate(events ?? []);
  const weekdayNames = ["一", "二", "三", "四", "五", "六", "日"];
  const dayEvents = byDate[selected] ?? [];
  const today = localTodayKey();
  const [yearStr, monthStr] = month.split("-");

  return (
    <section className="ws-today-card ws-cal">
      <h2>
        <Icon name="calendar" size={14} /> 日历
        <span className="ws-count-pill">{yearStr}年{Number(monthStr)}月</span>
        <span className="ws-cal-nav" style={{ marginLeft: "auto" }}>
          <button className="ws-icon-btn" title="上个月" aria-label="上个月" onClick={() => setMonth(prevMonth(month))}>
            <Icon name="chevronLeft" size={13} />
          </button>
          <button className="ws-icon-btn" title="回到本月" aria-label="回到本月" onClick={() => { setMonth(localMonthKey()); setSelected(localTodayKey()); }}>
            <Icon name="home" size={12} />
          </button>
          <button className="ws-icon-btn" title="下个月" aria-label="下个月" onClick={() => setMonth(nextMonth(month))}>
            <Icon name="chevronRight" size={13} />
          </button>
        </span>
      </h2>
      {failed && <div className="ws-error" role="alert" style={{ margin: 4 }}>日历加载失败：{failed}</div>}
      <div className="ws-cal-week">
        {weekdayNames.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="ws-cal-grid">
        {cells.map((c) => {
          const evs = byDate[c.key] ?? [];
          const hasTask = evs.some((e) => e.kind === "task");
          const hasMilestone = evs.some((e) => e.kind === "milestone");
          return (
            <button
              key={c.key}
              className={[
                "ws-cal-day",
                c.inMonth ? "" : "out",
                c.key === today ? "today" : "",
                c.key === selected ? "selected" : "",
              ].join(" ")}
              onClick={() => setSelected(c.key)}
              aria-label={`${c.key}，${evs.length} 个事件`}
            >
              {Number(c.key.slice(8, 10))}
              <span className="ws-cal-dots">
                {hasMilestone && <i className="ws-cal-dot ms" />}
                {hasTask && <i className="ws-cal-dot task" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ws-cal-events">
        <div className="ws-cal-ev-date">{selected === today ? "今天" : selected} 的安排{dayEvents.length > 0 && ` · ${dayEvents.length} 项`}</div>
        {events === null && <div className="ws-empty" style={{ padding: 10 }}>加载中…</div>}
        {events !== null && dayEvents.length === 0 && <div className="ws-empty" style={{ padding: 10 }}>这一天没有截止任务或里程碑</div>}
        {dayEvents.map((e, i) => (
          <div key={i} className="ws-cal-ev">
            <span className={`ws-pill ${e.kind === "milestone" ? "due-soon" : e.status === "doing" ? "st-doing" : "st-todo"}`}>
              {e.kind === "milestone" ? "里程碑" : e.status === "doing" ? "进行中" : "待办"}
            </span>
            <span className="ws-cal-ev-main">
              {e.code && <b>{e.code}</b>} {e.title}
              <small>{e.projectName}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
