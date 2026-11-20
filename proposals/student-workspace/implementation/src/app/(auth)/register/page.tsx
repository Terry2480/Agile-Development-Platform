"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "./actions";

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    registerAction,
    null,
  );

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 ac-card p-6">
      <h1 className="font-display text-2xl font-semibold text-ink">注册 AgileCampus</h1>
      <form action={formAction} className="space-y-3">
        <input name="name" placeholder="姓名" className="ac-field" />
        <input name="email" type="email" placeholder="邮箱" className="ac-field" />
        <input name="password" type="password" placeholder="密码（至少 8 位）" className="ac-field" />
        {state?.error && <p className="text-sm text-high">{state.error}</p>}
        <button disabled={pending} className="ac-btn w-full">
          {pending ? "注册中…" : "注册"}
        </button>
      </form>
      <p className="text-sm text-ink-soft">
        已有账号？<Link href="/login" className="text-primary hover:underline">去登录</Link>
      </p>
    </main>
  );
}
