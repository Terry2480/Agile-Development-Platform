"use client";

import { unbindFeishuAction } from "./actions";

type Props = { boundName: string | null; boundAtLabel: string | null; notice: string | null };

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  bound: { text: "飞书绑定成功。", ok: true },
  state_error: { text: "绑定校验失败，请重试。", ok: false },
  conflict: { text: "该飞书账号已绑定其他用户。", ok: false },
  error: { text: "绑定失败，请稍后重试。", ok: false },
};

export function FeishuCard({ boundName, boundAtLabel, notice }: Props) {
  const n = notice ? NOTICE[notice] : null;
  return (
    <section className="ac-card space-y-3 p-5">
      <h2 className="font-display text-base font-semibold text-ink">飞书通知</h2>
      <p className="text-sm text-ink-soft">
        绑定飞书后，任务被指派、完成，以及临期/逾期时，你会收到飞书私信提醒。
      </p>
      {n && (
        <p className={`text-sm ${n.ok ? "text-done" : "text-high"}`}>{n.text}</p>
      )}
      {boundName ? (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-ink">
            已绑定：<span className="font-medium">{boundName}</span>
            {boundAtLabel && <span className="ml-2 text-ink-faint">（{boundAtLabel}）</span>}
          </div>
          <form action={unbindFeishuAction}>
            <button type="submit" className="ac-btn-ghost text-sm">解绑</button>
          </form>
        </div>
      ) : (
        <>
          {/* /api/auth/feishu/login 是 Route Handler 而非页面（规则误判）；OAuth 起点须整页跳转，
              走 next/link 的客户端路由会拿不到服务端 302。 */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/feishu/login" className="ac-btn inline-block text-sm">
            绑定飞书
          </a>
        </>
      )}
    </section>
  );
}
