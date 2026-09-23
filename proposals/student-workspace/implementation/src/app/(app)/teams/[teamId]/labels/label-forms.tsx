"use client";

import { useActionState, useState } from "react";
import { LABEL_COLORS, LABEL_COLOR_CLASS } from "@/lib/board-columns";
import {
  createLabelAction,
  renameLabelAction,
  deleteLabelAction,
  type FormState,
} from "./actions";

export function NewLabelForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createLabelAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card flex flex-wrap items-end gap-2 p-4">
      <input type="hidden" name="teamId" value={teamId} />
      <label className="space-y-1">
        <span className="text-xs font-medium text-ink-soft">标签名</span>
        <input name="name" maxLength={20} className="ac-field text-sm" placeholder="如：论文" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-ink-soft">颜色</span>
        <select name="color" defaultValue="slate" className="ac-field w-auto text-sm">
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "新建标签"}
      </button>
      {state?.error && <p className="w-full text-sm text-high">{state.error}</p>}
    </form>
  );
}

export function LabelRow({
  teamId,
  label,
  usage,
  isAdmin,
}: {
  teamId: string;
  label: { id: string; name: string; color: string };
  usage: number;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [renameState, renameFormAction, renaming] = useActionState<FormState, FormData>(
    renameLabelAction,
    null,
  );
  const [deleteState, deleteFormAction, deleting] = useActionState<FormState, FormData>(
    deleteLabelAction,
    null,
  );

  return (
    <li className="ac-card flex flex-wrap items-center justify-between gap-2 p-4">
      <span className="flex items-center gap-2">
        <span className={`ac-badge ${LABEL_COLOR_CLASS[label.color] ?? LABEL_COLOR_CLASS.slate}`}>
          {label.name}
        </span>
        <span className="text-xs text-ink-faint">{usage} 个任务</span>
      </span>

      {isAdmin && !editing && (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-ink-faint hover:text-primary hover:underline"
          >
            编辑
          </button>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!confirm(`确认删除标签「${label.name}」？所有任务上的该标签将一并撕下。`))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="labelId" value={label.id} />
            <button disabled={deleting} className="text-xs text-high underline disabled:opacity-50">
              删除
            </button>
          </form>
        </span>
      )}

      {isAdmin && editing && (
        <form action={renameFormAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="labelId" value={label.id} />
          <input
            name="name"
            defaultValue={label.name}
            maxLength={20}
            className="ac-field w-32 py-1 text-sm"
          />
          <select name="color" defaultValue={label.color} className="ac-field w-auto py-1 text-sm">
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button disabled={renaming} className="ac-btn px-2 py-1 text-xs">
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ac-btn-ghost px-2 py-1 text-xs"
          >
            取消
          </button>
        </form>
      )}

      {(renameState?.error || deleteState?.error) && (
        <p className="w-full text-xs text-high">{renameState?.error ?? deleteState?.error}</p>
      )}
    </li>
  );
}
