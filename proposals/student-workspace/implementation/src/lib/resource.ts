import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { resourceUsages, users } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";

export interface CreateResourceUsageInput {
  resourceName: string;
  purpose?: string | null;
  startTime: Date;
  endTime?: Date | null;
}

// 登记资源占用。占用不分角色——任一团队成员皆可登记；纯登记无审批。
export async function createResourceUsage(
  actorId: string,
  teamId: string,
  input: CreateResourceUsageInput,
) {
  const membership = await getTeamMembership(actorId, teamId);
  if (!membership) throw new ForbiddenError();

  const name = input.resourceName.trim();
  if (!name) throw new AppError("资源名不能为空");
  if (input.endTime && input.endTime.getTime() <= input.startTime.getTime()) {
    throw new AppError("结束时间须晚于开始时间");
  }

  const [usage] = await db
    .insert(resourceUsages)
    .values({
      teamId,
      userId: actorId,
      resourceName: name,
      purpose: input.purpose?.trim() || null,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
    })
    .returning();
  return usage;
}

// 结束进行中占用（设 endTime=now）。登记者本人或团队 admin 可结束。
export async function endResourceUsage(actorId: string, usageId: string) {
  const [usage] = await db
    .select()
    .from(resourceUsages)
    .where(eq(resourceUsages.id, usageId));
  if (!usage) throw new AppError("占用记录不存在");

  if (usage.userId !== actorId) {
    const membership = await getTeamMembership(actorId, usage.teamId);
    if (!membership || membership.role !== "admin") throw new ForbiddenError();
  }
  if (usage.endTime) throw new AppError("该占用已结束");

  const [ended] = await db
    .update(resourceUsages)
    .set({ endTime: sql`now()` })
    .where(and(eq(resourceUsages.id, usageId), isNull(resourceUsages.endTime)))
    .returning();
  if (!ended) throw new AppError("该占用已结束");
  return ended;
}

function durationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

// 列举团队占用（倒序）+ 每人/每资源时长汇总（仅计已结束占用）。
export async function listTeamResourceUsages(actorId: string, teamId: string) {
  const membership = await getTeamMembership(actorId, teamId);
  if (!membership) throw new ForbiddenError();

  const rows = await db
    .select({
      id: resourceUsages.id,
      resourceName: resourceUsages.resourceName,
      purpose: resourceUsages.purpose,
      userId: resourceUsages.userId,
      userName: users.name,
      startTime: resourceUsages.startTime,
      endTime: resourceUsages.endTime,
    })
    .from(resourceUsages)
    .innerJoin(users, eq(resourceUsages.userId, users.id))
    .where(eq(resourceUsages.teamId, teamId))
    .orderBy(desc(resourceUsages.startTime));

  const usages = rows.map((r) => ({
    ...r,
    active: r.endTime === null,
    durationMinutes: r.endTime ? durationMinutes(r.startTime, r.endTime) : null,
  }));

  const byUserMap = new Map<string, { userId: string; userName: string; totalMinutes: number }>();
  const byResourceMap = new Map<string, { resourceName: string; totalMinutes: number }>();
  for (const u of usages) {
    if (u.durationMinutes === null) continue;
    const bu = byUserMap.get(u.userId) ?? { userId: u.userId, userName: u.userName, totalMinutes: 0 };
    bu.totalMinutes += u.durationMinutes;
    byUserMap.set(u.userId, bu);
    const br = byResourceMap.get(u.resourceName) ?? { resourceName: u.resourceName, totalMinutes: 0 };
    br.totalMinutes += u.durationMinutes;
    byResourceMap.set(u.resourceName, br);
  }

  return {
    usages,
    byUser: [...byUserMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes),
    byResource: [...byResourceMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes),
  };
}
