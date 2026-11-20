"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type FormState = { error: string } | null;

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/teams",
    });
    return null;
  } catch (e) {
    if (e instanceof AuthError) return { error: "邮箱或密码不正确" };
    throw e; // signIn 成功时抛出的 redirect 必须继续上抛
  }
}
