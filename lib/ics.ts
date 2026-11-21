// ICS（iCalendar）日历导入解析器：纯函数、不依赖运行环境，便于单测。
// 覆盖 Google 日历 / 手机系统日历导出的常见形态：
//  - 折行续行（RFC5545：以空格或制表符开头的行是上一行的延续）
//  - DTSTART;VALUE=DATE:20261119          → 全天事件
//  - DTSTART:20261119T090000Z             → UTC 时刻（按北京时间 +8 取日期）
//  - DTSTART;TZID=Asia/Shanghai:20261119T090000 → 本地时刻（直接取日期）
// 只取每个 VEVENT 的首个 DTSTART（RRULE 重复展开属超出课程范围，跳过并计数）。

export interface IcsEvent {
  /** 事件标题（SUMMARY），缺失时用「（无标题）」 */
  title: string;
  /** 事件日期，YYYY-MM-DD（北京时间口径，与站内日历一致） */
  dateKey: string;
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** 因缺少日期等原因被跳过的事件数 */
  skipped: number;
}

/** YYYYMMDD / YYYYMMDDTHHMMSS(Z) → YYYY-MM-DD（北京时间口径） */
export function icsDateToDateKey(raw: string): string | null {
  const value = raw.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00", ss = "00", z] = m;
  if (!z) return `${y}-${mo}-${d}`; // 全天事件 / 无 Z 的本地时刻：直接取日期
  // UTC 时刻：按北京时间 +8 小时后再取日期（与站内 dayKey 口径一致）
  const instant = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) + 8 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`;
}

/** 解析单行属性 "NAME;PARAM=V:value" → { name, value }（值中的转义还原） */
function parseLine(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const name = head.split(";")[0].toUpperCase();
  const rawValue = line.slice(colon + 1);
  // RFC5545 转义：\\n 换行、\\, \\; 、\\\\
  const value = rawValue.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  return { name, value };
}

export function parseIcsEvents(text: string): IcsParseResult {
  // 折行还原：以空格/制表符开头的行拼回上一行
  const unfolded: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if ((rawLine.startsWith(" ") || rawLine.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += rawLine.slice(1);
    } else if (rawLine.length > 0) {
      unfolded.push(rawLine);
    }
  }

  const events: IcsEvent[] = [];
  let skipped = 0;
  let current: { summary?: string; dtstart?: string; hasStart: boolean } | null = null;

  for (const line of unfolded) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      current = { hasStart: false };
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (current) {
        const dateKey = current.dtstart ? icsDateToDateKey(current.dtstart) : null;
        if (dateKey) {
          events.push({ title: current.summary?.trim() || "（无标题）", dateKey });
        } else {
          skipped += 1;
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.name === "SUMMARY") current.summary = parsed.value;
    if (parsed.name === "DTSTART" && !current.hasStart) {
      current.dtstart = parsed.value;
      current.hasStart = true;
    }
  }

  return { events, skipped };
}
