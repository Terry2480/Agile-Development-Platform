import { z } from "zod";

export const LEADER_DUTY = "负责人（组长）";
export const DEFAULT_DUTIES = [LEADER_DUTY, "展示人", "开发者"];
export const dutySchema = z.object({
  duty: z.string().trim().min(1, "请填写分工标签").max(30, "分工标签最多 30 个字").nullable(),
});

export function memberDuty(member: { role: string; duty: string | null }) {
  return member.role === "owner" ? LEADER_DUTY : member.duty;
}

export function canManageDuties(member: { role: string; duty: string | null }) {
  return memberDuty(member) === LEADER_DUTY;
}
