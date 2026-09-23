"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createApiToken, revokeApiToken } from "@/lib/api-token";
import { AppError } from "@/lib/errors";

// 生成结果：成功回传明文 token（只此一次），失败回传 error。
export type CreateTokenState =
  | { token: string; name: string }
  | { error: string }
  | null;

const nameSchema = z.string().trim().min(1, "请填写令牌名称").max(64, "名称过长");

export async function createTokenAction(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = nameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { token, name } = await createApiToken(session.user.id, parsed.data);
    revalidatePath("/settings/tokens");
    return { token, name };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

export async function revokeTokenAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const id = z.uuid().parse(formData.get("id"));
  await revokeApiToken(session.user.id, id);
  revalidatePath("/settings/tokens");
}
