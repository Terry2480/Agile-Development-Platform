import { z } from "zod";

export const milestoneSchema = z.object({
  name: z.string().trim().min(1, "请填写里程碑名称").max(80, "名称最多 80 个字"),
  dueOn: z.iso.date("请填写有效的截止日期"),
  requirements: z.string().trim().max(2000, "交付要求最多 2000 个字").default(""),
  completed: z.boolean().default(false),
  taskIds: z.array(z.number().int().positive()).max(200).default([]).transform((ids) => [...new Set(ids)]),
});

export function milestoneDays(dueOn: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Math.round((Date.parse(dueOn) - Date.parse(today)) / 86400000);
}
