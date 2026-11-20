"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createResourceUsage, endResourceUsage } from "@/lib/resource";
import { AppError } from "@/lib/errors";

export type FormState = { error: string } | null;

const createSchema = z.object({
  teamId: z.uuid(),
  resourceName: z.string().trim().min(1, "请填写资源名称"),
  purpose: z.string().trim().optional(),
  startTime: z.string().min(1, "请选择开始时间"),
  endTime: z.string().optional(),
});

export async function createResourceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const start = new Date(parsed.data.startTime);
  if (Number.isNaN(start.getTime())) return { error: "开始时间无效" };
  let end: Date | undefined;
  if (parsed.data.endTime) {
    end = new Date(parsed.data.endTime);
    if (Number.isNaN(end.getTime())) return { error: "结束时间无效" };
  }

  try {
    await createResourceUsage(session.user.id, parsed.data.teamId, {
      resourceName: parsed.data.resourceName,
      purpose: parsed.data.purpose,
      startTime: start,
      endTime: end,
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/resources`);
  return null;
}

const endSchema = z.object({ teamId: z.uuid(), usageId: z.uuid() });

export async function endResourceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = endSchema.parse(Object.fromEntries(formData));
  await endResourceUsage(session.user.id, parsed.usageId);
  revalidatePath(`/teams/${parsed.teamId}/resources`);
}
