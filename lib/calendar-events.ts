// 首页日历工具（纯函数，便于单测）：月历网格生成 + 事件按日期分组。
// 数据聚合见 app/api/home/calendar/route.ts；渲染见 components/ws/HomeCalendar.tsx。

export interface CalendarSprint {
  id: number;
  title: string;
  projectName: string;
  startsOn: string;
  endsOn: string;
}

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  kind: "task" | "milestone";
  title: string;
  code?: string; // 任务编号，如 AGILE-002
  status?: string; // 任务状态：todo / doing / done
  projectId: number;
  projectName: string;
}

/** 某月有多少天（month: 1-12） */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** YYYY-MM-DD → (year, month, day) */
export function splitDateKey(key: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error("日期格式应为 YYYY-MM-DD");
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 校验 YYYY-MM-DD，非法抛错 */
export function assertDateKey(key: string): string {
  splitDateKey(key);
  return key;
}

/** 校验 YYYY-MM，非法抛错 */
export function assertMonthKey(key: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error("月份格式应为 YYYY-MM");
  return key;
}

/**
 * 生成月历网格：周一起始，固定 6 行 7 列（42 天），
 * 每个元素带 inMonth 标记（前后月的补位天为 false）。
 */
export function monthDays(year: number, month: number): Array<{ key: string; inMonth: boolean }> {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  // getUTCDay(): 0=周日；周一起始的偏移 = (day + 6) % 7
  const firstWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const lead = (firstWeekday + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));
  const cells: Array<{ key: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    cells.push({ key, inMonth: d.getUTCMonth() + 1 === month && d.getUTCFullYear() === year });
  }
  return cells;
}

/** 事件按日期分组（保持传入顺序） */
export function groupEventsByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const map: Record<string, CalendarEvent[]> = {};
  for (const e of events) {
    (map[e.date] ??= []).push(e);
  }
  return map;
}

/** 上一月 / 下一月的 YYYY-MM */
export function prevMonth(month: string): string {
  const { year, month: m } = (() => {
    const [y, mm] = month.split("-").map(Number);
    return { year: y, month: mm };
  })();
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  const [y, mm] = month.split("-").map(Number);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
}

/** YYYY-MM 的起止日期键（含首尾） */
export function monthRange(month: string): { start: string; end: string } {
  assertMonthKey(month);
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  return { start, end };
}
