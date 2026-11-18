"use client";

// 全局命令面板（P1）：Ctrl/Cmd+K 打开，聚合搜索 项目 / 任务 / 文档 / 成员 并直达。
// 项目与文档、成员在打开时一次性载入索引本地过滤；任务按关键词走服务端跨项目搜索（防抖）。
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocSummary, type TaskItem } from "@/lib/api-client";
import { useWorkspace, Icon, Avatar } from "./shared";
import { toast } from "@/lib/toast";

type Member = { userId: number; displayName: string; teamName: string | null };
type MessageHit = {
  id: number;
  content: string;
  createdAt: string;
  projectId?: number;
  projectName?: string;
  authorName?: string;
  conversationId?: number;
  partnerName?: string;
  mine?: boolean;
};
type Entry =
  | { kind: "project"; id: number; label: string; sub: string }
  | { kind: "task"; id: number; label: string; sub: string; projectId: number }
  | { kind: "doc"; id: number; label: string; sub: string }
  | { kind: "member"; id: number; label: string; sub: string }
  | { kind: "chat"; id: number; label: string; sub: string; projectId: number }
  | { kind: "dmmsg"; id: number; label: string; sub: string; conversationId: number };

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  // 全局快捷键：Ctrl/Cmd + K 开关（占用原“聚焦任务搜索”的绑定）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return <PalettePanel onClose={() => setOpen(false)} />;
}

function PalettePanel({ onClose }: { onClose(): void }) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [messages, setMessages] = useState<{ projectHits: MessageHit[]; dmHits: MessageHit[] }>({ projectHits: [], dmHits: [] });
  const [members, setMembers] = useState<Member[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时建立文档与成员索引（各一次请求）
  useEffect(() => {
    api<{ docs: DocSummary[] }>("/api/docs").then((d) => setDocs(d.docs)).catch(() => setDocs([]));
    api<{ contacts: Member[] }>("/api/dm/contacts").then((d) => setMembers(d.contacts)).catch(() => setMembers([]));
    inputRef.current?.focus();
  }, []);

  // 任务与聊天走服务端搜索（跨我所有团队），300ms 防抖
  useEffect(() => {
    const query = q.trim();
    const timer = setTimeout(() => {
      if (!query) { setTasks([]); setMessages({ projectHits: [], dmHits: [] }); return; }
      api<{ tasks: TaskItem[] }>(`/api/tasks?q=${encodeURIComponent(query)}&limit=6`)
        .then((d) => setTasks(d.tasks))
        .catch(() => {});
      api<{ projectHits: MessageHit[]; dmHits: MessageHit[] }>(`/api/search/messages?q=${encodeURIComponent(query)}`)
        .then((d) => setMessages({ projectHits: d.projectHits ?? [], dmHits: d.dmHits ?? [] }))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const match = (s: string) => !query || s.toLowerCase().includes(query);
    const out: Entry[] = [];
    for (const p of ws.projects) {
      if (match(p.name) || match(p.key) || match(p.teamName)) {
        out.push({ kind: "project", id: p.id, label: p.name, sub: `项目 · ${p.teamName}` });
      }
    }
    for (const d of docs ?? []) {
      if (match(d.title) || match(d.projectName) || match(d.excerpt)) {
        out.push({ kind: "doc", id: d.id, label: d.title, sub: `文档 · ${d.projectName}` });
      }
    }
    for (const t of tasks) {
      if (match(t.title) || match(t.code)) {
        out.push({ kind: "task", id: t.id, label: `${t.code} ${t.title}`, sub: `任务 · ${t.projectName ?? ""}`, projectId: t.projectId });
      }
    }
    for (const hit of messages.projectHits) {
      out.push({ kind: "chat", id: hit.id, label: hit.content, sub: `聊天 · ${hit.authorName} @ ${hit.projectName}`, projectId: hit.projectId! });
    }
    for (const hit of messages.dmHits) {
      out.push({ kind: "dmmsg", id: hit.id, label: (hit.mine ? "我：" : "") + hit.content, sub: `私信 · ${hit.partnerName}`, conversationId: hit.conversationId! });
    }
    for (const m of members) {
      if (match(m.displayName) || (m.teamName ? match(m.teamName) : false)) {
        out.push({ kind: "member", id: m.userId, label: m.displayName, sub: `成员 · ${m.teamName ?? ""}` });
      }
    }
    return out.slice(0, 14);
  }, [q, ws.projects, docs, tasks, messages, members]);

  function run(entry: Entry) {
    onClose();
    if (entry.kind === "project") {
      ws.selectProject(entry.id);
      ws.setRailView("projects");
      ws.setFocusSection("tasks");
    } else if (entry.kind === "task") {
      ws.selectProject(entry.projectId);
      ws.setRailView("projects");
      ws.setFocusSection("tasks");
      ws.openTask(entry.id);
    } else if (entry.kind === "doc") {
      ws.openDoc(entry.id);
    } else if (entry.kind === "chat") {
      ws.selectProject(entry.projectId);
      ws.setRailView("projects");
      ws.setFocusSection("chat");
    } else if (entry.kind === "dmmsg") {
      ws.openDmConversation(entry.conversationId);
    } else {
      void ws.openDmWithPeer(entry.id).catch((e: Error) => toast(e.message, "error"));
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const item = results[selected]; if (item) run(item); }
    else if (e.key === "Escape") { onClose(); }
  }

  return (
    <div className="ws-cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ws-cmdk" role="dialog" aria-label="全局搜索">
        <div className="ws-cmdk-input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索项目、任务、文档、聊天、成员…"
            aria-label="全局搜索"
            onChange={(e) => { setQ(e.target.value); setSelected(0); }}
            onKeyDown={onInputKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="ws-cmdk-list">
          {results.length === 0 && (
            <div className="ws-cmdk-empty">
              {q.trim() ? "没有匹配的结果" : "输入关键词搜索；支持项目 / 任务 / 文档 / 聊天 / 成员，回车直达"}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              className={`ws-cmdk-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(r)}
            >
              {r.kind === "member"
                ? <Avatar name={r.label} colorKey={r.id} size="sm" />
                : <span className="ws-cmdk-ic"><Icon name={r.kind === "project" ? "grid" : r.kind === "task" ? "check" : r.kind === "doc" ? "book" : "message"} size={14} /></span>}
              <span className="ws-cmdk-label">{r.label}</span>
              <span className="ws-cmdk-sub">{r.sub}</span>
            </button>
          ))}
        </div>
        <div className="ws-cmdk-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Ctrl K 开关</span></div>
      </div>
    </div>
  );
}
