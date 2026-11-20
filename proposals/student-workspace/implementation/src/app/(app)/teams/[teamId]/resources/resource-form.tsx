"use client";

import { useActionState, useRef } from "react";
import { createResourceAction, type FormState } from "./actions";

// 当前本地时间 → datetime-local 所需的 "YYYY-MM-DDTHH:mm"
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ResourceForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createResourceAction,
    null,
  );
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="ac-card space-y-4 p-5">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-ink">登记资源占用</h2>
        <span className="text-xs text-ink-faint">纯登记 · 无需审批</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">资源名称</span>
          <input name="resourceName" placeholder="如 GPU-01 / 服务器A / 示波器" className="ac-field" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">用途（选填）</span>
          <input name="purpose" placeholder="如 训练模型 / 采集数据" className="ac-field" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">开始时间</span>
          <div className="flex gap-2">
            <input ref={startRef} name="startTime" type="datetime-local" className="ac-field" />
            <button
              type="button"
              onClick={() => startRef.current && (startRef.current.value = nowLocal())}
              className="ac-btn-ghost whitespace-nowrap"
            >
              此刻
            </button>
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">结束时间（留空 = 占用中）</span>
          <div className="flex gap-2">
            <input ref={endRef} name="endTime" type="datetime-local" className="ac-field" />
            <button
              type="button"
              onClick={() => endRef.current && (endRef.current.value = nowLocal())}
              className="ac-btn-ghost whitespace-nowrap"
            >
              此刻
            </button>
          </div>
        </label>
      </div>

      {state?.error && <p className="text-sm text-high">{state.error}</p>}

      <button disabled={pending} className="ac-btn">
        {pending ? "登记中…" : "登记占用"}
      </button>
    </form>
  );
}
