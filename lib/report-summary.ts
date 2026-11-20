import { z } from "zod";

export const reportRangeSchema = z.object({ start: z.iso.date(), end: z.iso.date() }).refine((r) => r.start <= r.end, "开始日期不能晚于结束日期");
export type ReportTask = { id: number; code: string; title: string; status: string; assignee: string; dueOn: string | null };
export type ReportSummary = {
  projectName: string; start: string; end: string; generatedAt: string;
  completed: ReportTask[]; doing: ReportTask[]; overdue: ReportTask[];
  milestones: { id: number; name: string; dueOn: string; completed: boolean; done: number; total: number }[];
};

export function reportToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function reportPreset(kind: "week" | "lastWeek" | "month", now = new Date()) {
  const today = reportToday(now);
  const date = new Date(`${today}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  if (kind === "month") return { start: today.slice(0, 8) + "01", end: today };
  date.setUTCDate(date.getUTCDate() - day - (kind === "lastWeek" ? 7 : 0));
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  return { start, end: kind === "lastWeek" ? date.toISOString().slice(0, 10) : today };
}
export function renderReport(data: ReportSummary, blockers: string, plan: string) {
  const list = (items: ReportTask[]) => items.length ? items.map((t) => `- ${t.code} ${t.title}（当前负责人：${t.assignee}${t.dueOn ? `；截止 ${t.dueOn}` : ""}）`).join("\n") : "- 暂无";
  return `# ${data.projectName} · 项目汇报\n\n统计期间：${data.start} 至 ${data.end}\n生成时间：${data.generatedAt}\n说明：期间完成情况来自任务完成日志与创建记录；进行中、逾期和里程碑为生成时的状态。\n\n## 期间完成（${data.completed.length}）\n${list(data.completed)}\n\n## 当前进行中（${data.doing.length}）\n${list(data.doing)}\n\n## 当前逾期未完成（${data.overdue.length}）\n${list(data.overdue)}\n\n## 里程碑进度\n${data.milestones.length ? data.milestones.map((m) => `- ${m.name}：截止 ${m.dueOn}，${m.completed ? "已完成" : "未完成"}；${m.total ? `关联任务 ${m.done}/${m.total} 已完成` : "未关联任务"}`).join("\n") : "- 暂无里程碑"}\n\n## 阻碍与需要协助的问题\n${blockers.trim() || "待补充"}\n\n## 下一步计划\n${plan.trim() || "待补充"}\n`;
}
