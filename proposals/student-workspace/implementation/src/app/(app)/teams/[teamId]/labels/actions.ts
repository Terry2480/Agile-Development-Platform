"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createLabel, renameLabel, deleteLabel } from "@/lib/label";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;

const COLOR = z.enum(["slate", "red", "amber", "green", "blue", "violet", "pink"]);

const createSchema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1, "请填写标签名"),
  color: COLOR,
});

export async function createLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createLabel(session.user.id, parsed.data.teamId, {
      name: parsed.data.name,
      color: parsed.data.color,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}

const renameSchema = z.object({
  teamId: z.uuid(),
  labelId: z.uuid(),
  name: z.string().trim().min(1, "请填写标签名"),
  color: COLOR,
});

export async function renameLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await renameLabel(session.user.id, parsed.data.labelId, {
      name: parsed.data.name,
      color: parsed.data.color,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}

const deleteSchema = z.object({ teamId: z.uuid(), labelId: z.uuid() });

export async function deleteLabelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteLabel(session.user.id, parsed.data.labelId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可管理标签" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/labels`);
  return null;
}
