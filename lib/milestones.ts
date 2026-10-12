import { z } from "zod";

export function teachingWeekDate(start: string, week: number, weekday = 7) {
  if (!z.iso.date().safeParse(start).success || !Number.isInteger(week) || week < 1 || week > 52 || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return "";
  const date = new Date(`${start}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1 + (week - 1) * 7 + weekday - 1);
  return date.toISOString().slice(0, 10);
}

export const milestoneSchema = z.object({
  name: z.string().trim().min(1, "请填写里程碑名称").max(80, "名称最多 80 个字"),
  dueOn: z.iso.date("请填写有效的截止日期").optional(),
  semesterStartsOn: z.iso.date("请填写有效的开学日期").nullable().optional(),
  teachingWeek: z.number().int().min(1).max(52).nullable().optional(),
  teachingWeekday: z.number().int().min(1).max(7).nullable().optional(),
  requirements: z.string().trim().max(2000, "交付要求最多 2000 个字").default(""),
  completed: z.boolean().default(false),
  taskIds: z.array(z.number().int().positive()).max(200).default([]).transform((ids) => [...new Set(ids)]),
}).superRefine((value, ctx) => {
  if (value.teachingWeek != null) {
    if (!value.semesterStartsOn || !value.teachingWeekday) ctx.addIssue({ code: "custom", message: "按教学周设置时，请填写开学日期、周数和星期", path: ["teachingWeek"] });
  } else if (!value.dueOn) ctx.addIssue({ code: "custom", message: "请填写截止日期", path: ["dueOn"] });
}).transform((value) => ({ ...value,
  dueOn: value.teachingWeek != null ? teachingWeekDate(value.semesterStartsOn!, value.teachingWeek, value.teachingWeekday!) : value.dueOn!,
  semesterStartsOn: value.teachingWeek != null ? value.semesterStartsOn! : null,
  teachingWeek: value.teachingWeek ?? null,
  teachingWeekday: value.teachingWeek != null ? value.teachingWeekday! : null,
}));

export function milestoneDays(dueOn: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Math.round((Date.parse(dueOn) - Date.parse(today)) / 86400000);
}
