"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction, type FormState } from "./actions";
import { FeishuLogin } from "./feishu-login";

function LoginForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    loginAction,
    null,
  );
  const registered = useSearchParams().get("registered");

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 lg:grid lg:place-items-center">
      <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary font-display text-xl font-bold text-white shadow-sm">
              A
            </span>
            <div>
              <p className="font-display text-xl font-semibold text-ink">AgileCampus</p>
              <p className="text-xs text-ink-soft">学生项目工作台</p>
            </div>
          </div>
          <h1 className="mt-12 max-w-lg font-display text-5xl font-semibold leading-tight text-ink">
            把项目从想法推进到成果。
          </h1>
          <p className="mt-5 text-sm text-ink-soft">课程 · 大创 · 竞赛 · 科研</p>
        </section>

        <section className="ac-card w-full space-y-4 p-6 sm:p-8">
          <div>
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-display text-lg font-bold text-white shadow-sm">
                A
              </span>
              <span className="font-display text-xl font-semibold text-ink">AgileCampus</span>
            </div>
            <h1 className="mt-5 font-display text-2xl font-semibold text-ink">登录项目工作台</h1>
            <p className="mt-1 text-sm text-ink-soft">进入你的团队、任务和项目资料。</p>
          </div>
          {registered && <p className="text-sm text-done">注册成功，请登录。</p>}
          <form action={formAction} className="space-y-3">
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="邮箱"
              className="ac-field"
              required
            />
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="密码"
              className="ac-field"
              required
            />
            {state?.error && <p className="text-sm text-high">{state.error}</p>}
            <button disabled={pending} className="ac-btn w-full">
              {pending ? "登录中…" : "登录"}
            </button>
          </form>
          <p className="text-sm text-ink-soft">
            没有账号？<Link href="/register" className="text-primary hover:underline">去注册</Link>
          </p>
          <Link href="/demo" className="ac-btn-ghost w-full justify-center">
            先浏览本地演示
          </Link>
          <FeishuLogin />
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
