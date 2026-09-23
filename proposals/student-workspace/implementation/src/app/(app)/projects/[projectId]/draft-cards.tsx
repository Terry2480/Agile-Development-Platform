"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Draft = { tool: string; draft: unknown };
type Option = { id: string; name: string };

async function commit(projectId: string, tool: string, draft: unknown): Promise<string | null> {
  const res = await fetch("/api/chat/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, tool, draft }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return data.error ?? "落库失败";
  if (Array.isArray(data.conflicts) && data.conflicts.length > 0)
    return `有 ${data.conflicts.length} 项因他人改动未落库，请刷新后重试`;
  return null;
}

function CardShell({
  title,
  onConfirm,
  children,
}: {
  title: string;
  onConfirm: () => Promise<string | null>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (state === "done")
    return (
      <div className="ac-card p-2 text-xs text-done">
        {title}：已落库 ✓
      </div>
    );

  return (
    <div className="ac-card space-y-2 border-accent/30 bg-accent-soft p-2 text-sm">
      <p className="text-xs font-medium text-accent">待确认：{title}</p>
      {children}
      {err && <p className="text-xs text-high">{err}</p>}
      <button
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          setErr(null);
          const e = await onConfirm();
          if (e) {
            setErr(e);
            setState("idle");
          } else {
            setState("done");
            router.refresh();
          }
        }}
        className="ac-btn px-2 py-1 text-xs"
      >
        {state === "pending" ? "落库中…" : "确认落库"}
      </button>
    </div>
  );
}

export function DraftCards({
  projectId,
  drafts,
  members,
  milestones,
}: {
  projectId: string;
  drafts: Draft[];
  members: Option[];
  milestones: Option[];
}) {
  return (
    <div className="mt-2 space-y-2">
      {drafts.map((d, i) => (
        <DraftCard key={i} projectId={projectId} draft={d} members={members} milestones={milestones} />
      ))}
    </div>
  );
}

function DraftCard({
  projectId,
  draft,
  members,
  milestones,
}: {
  projectId: string;
  draft: Draft;
  members: Option[];
  milestones: Option[];
}) {
  const [data, setData] = useState<Record<string, unknown>>(draft.draft as Record<string, unknown>);

  if (draft.tool === "create_project") {
    const d = data as { name?: string; description?: string; startDate?: string; endDate?: string };
    return (
      <CardShell title="创建项目" onConfirm={() => commit(projectId, "create_project", d)}>
        <input
          value={d.name ?? ""}
          onChange={(e) => setData({ ...d, name: e.target.value })}
          placeholder="项目名称"
          className="ac-field text-xs"
        />
        <textarea
          value={d.description ?? ""}
          onChange={(e) => setData({ ...d, description: e.target.value })}
          placeholder="描述"
          className="ac-field text-xs"
          rows={2}
        />
        <div className="flex gap-1">
          <input type="date" value={d.startDate ?? ""} onChange={(e) => setData({ ...d, startDate: e.target.value })} className="ac-field w-auto text-xs" />
          <input type="date" value={d.endDate ?? ""} onChange={(e) => setData({ ...d, endDate: e.target.value })} className="ac-field w-auto text-xs" />
        </div>
      </CardShell>
    );
  }

  if (draft.tool === "create_milestone") {
    const d = data as { title?: string; targetDate?: string };
    return (
      <CardShell title="创建里程碑" onConfirm={() => commit(projectId, "create_milestone", d)}>
        <input
          value={d.title ?? ""}
          onChange={(e) => setData({ ...d, title: e.target.value })}
          placeholder="里程碑名称"
          className="ac-field text-xs"
        />
        <input
          type="date"
          value={d.targetDate ?? ""}
          onChange={(e) => setData({ ...d, targetDate: e.target.value || undefined })}
          className="ac-field w-auto text-xs"
        />
      </CardShell>
    );
  }

  if (draft.tool === "decompose_tasks") {
    const d = data as {
      tasks: { title: string; assigneeId?: string; priority?: string; dueDate?: string; milestoneId?: string }[];
    };
    const setTask = (idx: number, patch: object) =>
      setData({ ...d, tasks: d.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });
    return (
      <CardShell title={`拆解任务（${d.tasks.length}）`} onConfirm={() => commit(projectId, "decompose_tasks", d)}>
        {d.tasks.map((t, idx) => (
          <div key={idx} className="flex flex-wrap gap-1 border-b border-line pb-1">
            <input value={t.title} onChange={(e) => setTask(idx, { title: e.target.value })} className="ac-field flex-1 text-xs" />
            <select value={t.assigneeId ?? ""} onChange={(e) => setTask(idx, { assigneeId: e.target.value || undefined })} className="ac-field w-auto text-xs">
              <option value="">未分配</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select value={t.priority ?? "medium"} onChange={(e) => setTask(idx, { priority: e.target.value })} className="ac-field w-auto text-xs">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
            <input type="date" value={t.dueDate ?? ""} onChange={(e) => setTask(idx, { dueDate: e.target.value || undefined })} className="ac-field w-auto text-xs" />
            <button type="button" onClick={() => setData({ ...d, tasks: d.tasks.filter((_, i) => i !== idx) })} className="text-xs text-high hover:underline">
              删
            </button>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "update_tasks") {
    const d = data as { updates: { taskId: string; updatedAt: string; patch: Record<string, unknown> }[] };
    return (
      <CardShell title={`批量变更（${d.updates.length}）`} onConfirm={() => commit(projectId, "update_tasks", d)}>
        {d.updates.map((u, idx) => (
          <div key={idx} className="border-b border-line pb-1 text-xs">
            <span className="text-ink-soft">任务 {u.taskId.slice(0, 8)}…：</span>
            <span className="text-ink">{JSON.stringify(u.patch)}</span>
          </div>
        ))}
      </CardShell>
    );
  }

  if (draft.tool === "plan_sprint") {
    const d = data as { milestoneId: string; taskIds: string[]; dueDate: string };
    return (
      <CardShell title={`排期（${d.taskIds.length} 任务）`} onConfirm={() => commit(projectId, "plan_sprint", d)}>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <select value={d.milestoneId} onChange={(e) => setData({ ...d, milestoneId: e.target.value })} className="ac-field w-auto text-xs">
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input type="date" value={d.dueDate} onChange={(e) => setData({ ...d, dueDate: e.target.value })} className="ac-field w-auto text-xs" />
          <span className="text-ink-soft">{d.taskIds.length} 个任务</span>
        </div>
      </CardShell>
    );
  }

  return null;
}
