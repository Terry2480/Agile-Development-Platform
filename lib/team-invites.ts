import { z } from "zod";
import { canManageDuties } from "./team-duties";
export const joinCodeSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-F0-9]{16}$/, "请输入完整的 16 位邀请码") });
export function canManageInvites(member: { role: string; duty: string | null; duties?: string[] | null }) {
  return member.role === "owner" || member.role === "admin" || canManageDuties(member);
}
