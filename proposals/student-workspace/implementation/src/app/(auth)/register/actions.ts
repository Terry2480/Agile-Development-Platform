"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createUser } from "@/lib/user";
import { AppError } from "@/lib/errors";

const registerSchema = z.object({
  name: z.string().min(1, "请填写姓名"),
  email: z.email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(64, "密码最长 64 位"),
});

export type FormState = { error: string } | null;

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createUser(parsed.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect("/login?registered=1");
}
