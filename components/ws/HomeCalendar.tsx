"use client";

// 首页日历卡片：月历网格（周一起始）+ 任务截止/里程碑事件点，
// 点选日期查看当日安排；月份可前后切换；30 秒轮询保持实时。
import { useCallback, useEffect, useState } from "react";
import { api, dayKey } from "@/lib/api-client";
import { Icon } from "./shared";
import { monthDays, groupEventsByDate, prevMonth, nextMonth, type CalendarEvent, type CalendarSprint } from "@/lib/calendar-events";

// 与后端 /api/home/calendar 缺省口径一致：统一用东八区（Asia/Hong_Kong）当天
const localTodayKey = () => dayKey(new Date().toISOString());
const localMonthKey = () => localTodayKey().slice(0, 7);

type CalendarData = {
  month: string;
  events: CalendarEvent[];
  timeline: { tasks: CalendarEvent[]; sprints: CalendarSprint[] };
};

export function HomeCalendar({ projectId }: { projectId?: number } = {}) {
  const [month, setMonth] = useState(localMonthKey());
  const [data, setData] = useState<CalendarData | null>(null);
  const [view, setView] = useState<"month" | "gantt">("month");
  const events = data?.month === month ? data.events : null;
  const [selected, setSelected] = useState<string>(localTodayKey());
  const [failed, setFailed] = useState("");

  const load = useCallback((signal: AbortSignal) => {
    const query = new URLSearchParams({ month });
    if (projectId !== undefined) query.set("projectId", String(projectId));
    api<CalendarData>(`/api/home/calendar?${query}`, { signal })
      .then((result) => { if (!signal.aborted) { setData(result); setFailed(""); } })
      .catch((error: Error) => { if (!signal.aborted) setFailed(error.message); });
  }, [month, projectId]);

  useEffect(() => {
    let request = new AbortController();
    load(request.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      request.abort();
      request = new AbortController();
      load(request.signal);
    }, 30000);
    return () => {
      clearInterval(timer);
      request.abort();
    };
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
        <Icon name="calendar" size={14} /> {projectId === undefined ? "日历" : "项目排期"}
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
      <div className="ws-cal-views" role="group" aria-label="日历视图">
        <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>月历</button>
        <button type="button" aria-pressed={view === "gantt"} onClick={() => setView("gantt")}>甘特时间线</button>
      </div>
      {view === "gantt" ? (
        events && data ? <CalendarTimeline days={cells.filter(cell => cell.inMonth).map(cell => cell.key)} today={today} data={data} />
          : !failed && <p className="ws-empty" role="status">正在加载时间线…</p>
      ) : <>
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
      </>}
    </section>
  );
}

function CalendarTimeline({ days, today, data }: { days: string[]; today: string; data: CalendarData }) {
  const first = days[0];
  const last = days[days.length - 1];
  const rows = [
    ...data.timeline.sprints.map(sprint => ({
      key: `sprint-${sprint.id}`, title: sprint.title, project: sprint.projectName,
      start: sprint.startsOn, end: sprint.endsOn, kind: "sprint", label: "迭代",
    })),
    ...[...data.timeline.tasks, ...data.events.filter(event => event.kind === "milestone")]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((event, index) => ({
        key: `event-${index}`, title: event.code ? `${event.code} ${event.title}` : event.title,
        project: event.projectName, start: event.date, end: event.date,
        kind: event.kind, label: event.kind === "milestone" ? "里程碑" : "任务截止",
      })),
  ];

  if (!rows.length) return <p className="ws-empty">本月暂无已排期迭代、任务截止或里程碑</p>;
  const columns = `repeat(${days.length}, minmax(40px, 1fr))`;
  const todayColumn = days.indexOf(today) + 1;

  return (
    <div className="ws-cal-timeline" role="region" aria-label="月度甘特时间线" tabIndex={0}>
      <table>
        <thead><tr>
          <th scope="col">计划事项</th>
          <th scope="col">
            <div className="ws-cal-track" style={{ gridTemplateColumns: columns }}>
              {days.map(date => <span key={date} className={date === today ? "is-today" : undefined} aria-current={date === today ? "date" : undefined}>{Number(date.slice(-2))}日</span>)}
            </div>
          </th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const startColumn = days.indexOf(row.start < first ? first : row.start) + 1;
          const endColumn = days.indexOf(row.end > last ? last : row.end) + 2;
          const dates = row.start === row.end ? row.start : `${row.start} 至 ${row.end}`;
          return <tr key={row.key}>
            <th scope="row">
              <span className="ws-cal-timeline-title">{row.title}</span>
              <small>{row.project} · {row.label}</small>
            </th>
            <td>
              <div className="ws-cal-track" style={{ gridTemplateColumns: columns }}>
                {todayColumn > 0 && <span className="ws-cal-timeline-today" aria-hidden="true" style={{ gridColumn: todayColumn }} />}
                <span
                  className={`ws-cal-timeline-mark ${row.kind}`}
                  style={{ gridColumn: `${startColumn} / ${endColumn}` }}
                  title={`${row.title} · ${dates}`}
                  aria-label={dates}
                  role="img"
                />
              </div>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
