import { z } from "zod";

export const LEADER_DUTY = "负责人（组长）";
export const DEFAULT_DUTIES = [LEADER_DUTY, "展示人", "开发者"];
export const dutySchema = z.object({
  duty: z.string().trim().min(1, "请填写分工标签").max(30, "分工标签最多 30 个字").nullable(),
});

export const dutiesSchema = z.object({
  duties: z.array(dutySchema.shape.duty.unwrap()).max(10, "每位成员最多 10 个分工标签")
    .transform((values) => [...new Set(values)]),
});

type DutyMember = { role: string; duty: string | null; duties?: string[] | null };

export function memberDuties(member: DutyMember): string[] {
  const duties = member.duties ?? (member.duty ? [member.duty] : []);
  return [...new Set(member.role === "owner" ? [LEADER_DUTY, ...duties] : duties)];
}

export function memberDuty(member: DutyMember) {
  return memberDuties(member)[0] ?? null;
}

export function canManageDuties(member: DutyMember) {
  return memberDuties(member).includes(LEADER_DUTY);
}
