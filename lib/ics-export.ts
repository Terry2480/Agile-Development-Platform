// ICS 日历导出：把站内事件（任务截止 / 里程碑 / 个人待办）组装成标准 iCalendar 文本，
// 可被 Google 日历 / 手机系统日历 / Outlook 直接导入——补全「日历可进可出」的出口侧。
// 纯函数，便于单测；下载触发在调用方（app/suite/page.tsx）。

export interface IcsExportEvent {
  /** 事件日期，YYYY-MM-DD（北京时间口径） */
  dateKey: string;
  /** 事件标题 */
  title: string;
  /** 来源类型：任务截止 / 里程碑 / 个人待办（写入 CATEGORIES 便于导入端筛选） */
  kind: "task" | "milestone" | "personal";
}

/** RFC5545 文本转义：反斜杠、分号、逗号、换行 */
function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** YYYY-MM-DD → YYYYMMDD（VALUE=DATE 全天事件） */
function toIcsDate(dateKey: string): string {
  return dateKey.replaceAll("-", "");
}

/** 当前时刻的 UTC 基础格式（DTSTAMP） */
function icsStampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** 简易 UID：日期 + 标题哈希，保证同一天重名事件不撞 */
function makeUid(event: IcsExportEvent, index: number): string {
  let hash = 0;
  const seed = `${event.dateKey}|${event.title}|${event.kind}`;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `${event.dateKey.replace(/-/g, "")}-${hash.toString(36)}-${index}@agilecampus.local`;
}

export function buildIcs(events: IcsExportEvent[], calName: string): string {
  const sorted = [...events].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AgileCampus//敏捷校园//CN",
    `X-WR-CALNAME:${icsEscape(calName)}`,
    "CALSCALE:GREGORIAN",
  ];
  for (const [index, event] of sorted.entries()) {
    const day = toIcsDate(event.dateKey);
    const next = new Date(Date.UTC(
      Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + 1,
    ));
    const pad = (n: number) => String(n).padStart(2, "0");
    const dayEnd = `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
    const kindText = event.kind === "task" ? "任务截止" : event.kind === "milestone" ? "里程碑" : "个人待办";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${makeUid(event, index)}`,
      `DTSTAMP:${icsStampNow()}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${dayEnd}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `CATEGORIES:${kindText}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** 导出文件名：日历名里的路径敏感字符替换掉 */
export function icsFileName(calName: string): string {
  const safe = calName.replace(/[\\/:*?"<>|]/g, "_").trim() || "日历";
  return `${safe}.ics`;
}
