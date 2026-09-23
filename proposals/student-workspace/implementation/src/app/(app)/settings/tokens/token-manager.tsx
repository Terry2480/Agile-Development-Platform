"use client";

import { useActionState, useState } from "react";
import { createTokenAction, revokeTokenAction, type CreateTokenState } from "./actions";

export interface TokenRow {
  id: string;
  name: string;
  createdAtLabel: string;
  lastUsedLabel: string | null;
  revoked: boolean;
}

export function TokenManager({ tokens }: { tokens: TokenRow[] }) {
  const [state, formAction, pending] = useActionState<CreateTokenState, FormData>(
    createTokenAction,
    null,
  );
  const justCreated = state && "token" in state ? state : null;
  const error = state && "error" in state ? state.error : null;

  return (
    <div className="space-y-6">
      {/* 生成新令牌 */}
      <form action={formAction} className="ac-card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-ink">生成新令牌</h2>
          <span className="text-xs text-ink-faint">供 Claude Code 等外部程序写入</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="name"
            placeholder="令牌名称，如「我的 MacBook」"
            className="ac-field sm:flex-1"
            maxLength={64}
          />
          <button disabled={pending} className="ac-btn whitespace-nowrap">
            {pending ? "生成中…" : "生成令牌"}
          </button>
        </div>
        {error && <p className="text-sm text-high">{error}</p>}
      </form>

      {/* 明文只显一次 */}
      {justCreated && <RevealBox token={justCreated.token} name={justCreated.name} />}

      {/* 令牌列表 */}
      <div className="ac-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-display text-base font-semibold text-ink">我的令牌</h2>
        </div>
        {tokens.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-soft">
            尚无令牌——生成一个，即可让 Claude Code 替你添加任务、登记资源。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{t.name}</span>
                    {t.revoked ? (
                      <span className="ac-badge bg-low-soft text-low">已撤销</span>
                    ) : (
                      <span className="ac-badge bg-done/12 text-done">生效中</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    创建于 {t.createdAtLabel}
                    {t.lastUsedLabel ? ` · 最近使用 ${t.lastUsedLabel}` : " · 从未使用"}
                  </p>
                </div>
                {!t.revoked && (
                  <form action={revokeTokenAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="ac-btn-ghost text-high hover:border-high hover:text-high">
                      撤销
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RevealBox({ token, name }: { token: string; name: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-card border border-accent/40 bg-accent-soft p-5">
      <div className="flex items-center gap-2">
        <span className="ac-badge bg-accent/15 text-accent">令牌已生成</span>
        <span className="text-sm font-medium text-ink">{name}</span>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        请立即复制并妥善保存——<strong className="text-ink">此明文只显示这一次</strong>，离开本页后无法再次查看。
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-field border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink">
          {token}
        </code>
        <button onClick={copy} className="ac-btn whitespace-nowrap" type="button">
          {copied ? "已复制 ✓" : "复制"}
        </button>
      </div>
    </div>
  );
}
