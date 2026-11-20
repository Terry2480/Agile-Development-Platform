"use client";

// 云文档面板（v6 文档协作）：
// 列表（搜索/项目过滤/文件夹分组折叠）+ Markdown 编辑器（左写右览、自动保存、版本历史）
// + 文档评论（划词引用、@提及通知）+ 目录大纲 TOC + [[任务码]] 引用卡片（点击直达任务）
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, fmtDateShort, fmtTime,
  type DocDetail, type DocSummary, type DocVersion, type DocComment, type TaskItem,
} from "@/lib/api-client";
import { renderMarkdown, extractToc } from "@/lib/markdown";
import { useWorkspace, Icon, Modal } from "./shared";
import { DocListSkeleton } from "./LoadingSkeleton";
import { toast } from "@/lib/toast";

export function DocsPanel() {
  const ws = useWorkspace();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<"all" | number>("all");
  const [openDoc, setOpenDoc] = useState<DocDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  // 命令面板跳转：docTargetId 变化（含本面板未挂载时设置的值）即拉取详情并打开
  const docTargetId = ws.docTargetId;
  useEffect(() => {
    if (docTargetId === null) return;
    api<{ doc: DocDetail }>(`/api/docs/${docTargetId}`)
      .then((d) => { setOpenDoc(d.doc); })
      .catch((e: Error) => { setError(e.message); });
  }, [docTargetId]);

  const refresh = useCallback(() => {
    api<{ docs: DocSummary[] }>("/api/docs")
      .then((d) => { setDocs(d.docs); setError(""); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = (docs ?? []).filter((doc) => {
    if (projectFilter !== "all" && doc.projectId !== projectFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return doc.title.toLowerCase().includes(q) || doc.excerpt.toLowerCase().includes(q);
  });

  // 文件夹分组：名称排序，未分组最后；组内按更新时间（接口已排序）
  const groups: [string, DocSummary[]][] = [];
  for (const doc of filtered) {
    const name = doc.folder ?? "未分组";
    const last = groups.at(-1);
    if (last && last[0] === name) last[1].push(doc);
    else groups.push([name, [doc]]);
  }
  const named = groups.filter(([name]) => name !== "未分组");
  const ungrouped = groups.filter(([name]) => name === "未分组");
  const orderedGroups = [...named, ...ungrouped];

  // 编辑器退出后回到列表并刷新（保存/删除都会改变列表数据）
  if (openDoc) {
    return (
      <DocEditor
        key={openDoc.id}
        initial={openDoc}
        allFolders={[...new Set((docs ?? []).map((d) => d.folder).filter((f): f is string => !!f))]}
        onExit={() => { setOpenDoc(null); refresh(); }}
      />
    );
  }

  function openDocById(id: number) {
    setOpeningId(id);
    setError("");
    api<{ doc: DocDetail }>(`/api/docs/${id}`)
      .then((d) => { setOpenDoc(d.doc); setOpeningId(null); })
      .catch((e: Error) => { setError(e.message); setOpeningId(null); });
  }

  return (
    <div className="ws-docs-list">
      <div className="ws-panel-head">
        <h2><Icon name="book" size={16} /> 云文档 <span className="ws-count-pill">{docs?.length ?? 0} 篇</span></h2>
        <button className="ws-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> 新建文档</button>
      </div>

      <div className="ws-docs-toolbar">
        <div className="ws-search" style={{ margin: 0, flex: 1, maxWidth: 320 }}>
          <Icon name="search" size={13} />
          <input placeholder="搜索标题或内容摘要…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="ws-select" style={{ width: "auto" }} value={String(projectFilter)} onChange={(e) => setProjectFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
          <option value="all">全部项目</option>
          {ws.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {error && <div className="ws-error" role="alert">{error} <button className="ws-btn" onClick={refresh}>重试</button></div>}
      {!docs && !error && <DocListSkeleton rows={3} />}
      {docs && filtered.length === 0 && (
        <div className="ws-empty">
          {docs.length === 0 ? "还没有文档。点击「新建文档」，为项目沉淀会议纪要、需求说明和接口约定。" : "没有符合筛选条件的文档"}
        </div>
      )}

      {orderedGroups.map(([folder, items]) => {
        const collapsed = collapsedFolders.has(folder);
        return (
          <div key={folder} className="ws-doc-group">
            {folder !== "未分组" && (
              <button className="ws-doc-group-head" aria-expanded={!collapsed}
                onClick={() => setCollapsedFolders((prev) => {
                  const next = new Set(prev);
                  if (next.has(folder)) next.delete(folder); else next.add(folder);
                  return next;
                })}>
                <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={13} />
                <b>{folder}</b>
                <span className="ws-count-pill">{items.length}</span>
              </button>
            )}
            {!collapsed && items.map((doc) => (
              <button key={doc.id} className="ws-doc-row" disabled={openingId !== null} onClick={() => openDocById(doc.id)}>
                <span className="ws-doc-ic"><Icon name="book" size={14} /></span>
                <span className="ws-doc-main">
                  <span className="ws-doc-title">{openingId === doc.id ? "正在打开…" : doc.title}</span>
                  <span className="ws-doc-sub">
                    <span className="ws-doc-chip">{doc.projectName}</span>
                    {doc.updatedByName ? `${doc.updatedByName} 更新于 ` : "更新于 "}
                    {fmtDateShort(doc.updatedAt)} {fmtTime(doc.updatedAt)}
                  </span>
                  <span className="ws-doc-excerpt">{doc.excerpt}</span>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
            ))}
          </div>
        );
      })}

      {creating && (
        <NewDocModal
          folders={[...new Set((docs ?? []).map((d) => d.folder).filter((f): f is string => !!f))]}
          onClose={() => setCreating(false)}
          onCreated={(doc) => { setCreating(false); setOpenDoc(doc); refresh(); }}
        />
      )}
    </div>
  );
}

/* ---------- 新建文档 ---------- */

function NewDocModal({ folders, onClose, onCreated }: { folders: string[]; onClose(): void; onCreated(doc: DocDetail): void }) {
  const ws = useWorkspace();
  const [projectId, setProjectId] = useState<number | null>(ws.selectedId ?? ws.projects[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 按团队分组展示项目，方便在多团队多项目间选择
  const grouped: [string, typeof ws.projects][] = [];
  for (const p of ws.projects) {
    const last = grouped.at(-1);
    if (last && last[0] === p.teamName) last[1].push(p);
    else grouped.push([p.teamName, [p]]);
  }

  async function submit() {
    if (busy) return;
    if (projectId === null) return setError("请选择所属项目");
    if (!title.trim()) return setError("请填写文档标题");
    setBusy(true);
    try {
      const d = await api<{ doc: DocDetail }>("/api/docs", {
        method: "POST",
        json: { projectId, title: title.trim(), folder: folder.trim() || null },
      });
      toast("文档已创建");
      onCreated(d.doc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建文档" onClose={busy ? () => {} : onClose}>
      <div className="ws-field">
        <label htmlFor="doc-project">所属项目（项目成员均可编辑）</label>
        <select id="doc-project" className="ws-select" value={projectId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))}>
          {grouped.map(([teamName, list]) => (
            <optgroup key={teamName} label={teamName}>
              {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="ws-field">
        <label htmlFor="doc-title">文档标题</label>
        <input id="doc-title" className="ws-input" maxLength={80} placeholder="例如：需求评审纪要、接口约定" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      </div>
      <div className="ws-field">
        <label htmlFor="doc-folder">分组（可选）</label>
        <input id="doc-folder" className="ws-input" maxLength={30} list="doc-folder-options" placeholder="例如：会议纪要、接口文档" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <datalist id="doc-folder-options">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      {error && <div className="ws-error" role="alert">{error}</div>}
      <div className="ws-modal-actions">
        <button className="ws-btn" disabled={busy} onClick={onClose}>取消</button>
        <button className="ws-btn primary" disabled={busy || !title.trim() || projectId === null} onClick={() => void submit()}>{busy ? "创建中…" : "创建并编辑"}</button>
      </div>
    </Modal>
  );
}

/* ---------- 文档编辑器：自动保存 + 编辑/预览 + 历史版本 + 评论 + TOC + 任务卡 ---------- */

type SavePhase = "saved" | "saving" | "error";

function DocEditor({ initial, allFolders, onExit }: { initial: DocDetail; allFolders: string[]; onExit(): void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [folder, setFolder] = useState(initial.folder ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [phase, setPhase] = useState<SavePhase>("saved");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState(initial.updatedAt);
  const [savedSnapshot, setSavedSnapshot] = useState({ title: initial.title, content: initial.content, folder: initial.folder ?? "" });
  const [showVersions, setShowVersions] = useState(false);
  const [deleting, setDeleting] = useState<"idle" | "confirm" | "busy">("idle");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [commentText, setCommentText] = useState("");
  const [pendingQuote, setPendingQuote] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [taskMap, setTaskMap] = useState<Map<string, TaskItem>>(new Map());
  const savingRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const toc = extractToc(content);
  const dirty = title.trim() !== savedSnapshot.title || content !== savedSnapshot.content || folder.trim() !== savedSnapshot.folder;

  // 打开文档时拉取同项目任务表，供 [[任务码]] 卡片解析（标题悬浮 + 点击直达）
  useEffect(() => {
    api<{ tasks: TaskItem[] }>(`/api/tasks?projectId=${initial.projectId}`)
      .then((d) => setTaskMap(new Map(d.tasks.map((t) => [t.code, t]))))
      .catch(() => {});
  }, [initial.projectId]);

  // 评论面板：打开即加载；发表后刷新
  const loadComments = useCallback(() => {
    api<{ comments: DocComment[] }>(`/api/docs/${initial.id}/comments`)
      .then((d) => setComments(d.comments))
      .catch((e: Error) => toast(e.message, "error"));
  }, [initial.id]);
  useEffect(() => {
    if (commentsOpen && comments === null) loadComments();
  }, [commentsOpen, comments, loadComments]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const nextTitle = title.trim();
    if (!nextTitle) { setPhase("error"); setSaveError("标题不能为空"); return; }
    savingRef.current = true;
    setPhase("saving");
    try {
      const d = await api<{ doc: DocDetail }>(`/api/docs/${initial.id}`, {
        method: "PUT", json: { title: nextTitle, content, folder: folder.trim() || null },
      });
      setSavedSnapshot({ title: d.doc.title, content: d.doc.content, folder: d.doc.folder ?? "" });
      setFolder(d.doc.folder ?? "");
      setSavedAt(d.doc.updatedAt);
      setPhase("saved");
      setSaveError("");
    } catch (e) {
      setPhase("error");
      setSaveError((e as Error).message);
      toast(`文档保存失败：${(e as Error).message}`, "error");
    } finally {
      savingRef.current = false;
    }
  }, [title, content, folder, initial.id]);

  // 自动保存：停止输入 1.2 秒后触发（是否“有改动”在渲染中推导，不在 effect 里改状态）
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => { void save(); }, 1200);
    return () => clearTimeout(timer);
  }, [dirty, save]);

  // 有未保存内容时拦截误关页面
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // 任务卡片：渲染后补充悬浮标题（点击走容器事件委托）
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    for (const chip of root.querySelectorAll<HTMLButtonElement>(".ws-doc-task")) {
      const task = taskMap.get(chip.dataset.code ?? "");
      chip.title = task ? `${task.title}` : "任务不存在或已删除";
      if (task) chip.dataset.taskId = String(task.id);
    }
  }, [content, mode, taskMap]);

  // 预览区点击 [[任务码]] 卡片 → 直达任务（selectProject + 打开抽屉）
  function onPreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    const chip = (e.target as HTMLElement).closest(".ws-doc-task") as HTMLButtonElement | null;
    if (!chip) return;
    const taskId = Number(chip.dataset.taskId);
    if (!taskId) { toast("任务不存在或已删除", "error"); return; }
    ws.selectProject(initial.projectId);
    ws.setRailView("projects");
    ws.setFocusSection("tasks");
    ws.openTask(taskId);
  }

  // 划词评论：在预览区选中文字后松开，自动作为引用片段
  function captureSelection() {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text) setPendingQuote(text.slice(0, 200));
  }

  async function submitComment() {
    const text = commentText.trim();
    if (!text || commentBusy) return;
    setCommentBusy(true);
    try {
      const d = await api<{ comment: DocComment }>(`/api/docs/${initial.id}/comments`, {
        method: "POST",
        json: { content: text, quote: pendingQuote || null },
      });
      setComments((items) => [...(items ?? []), d.comment]);
      setCommentText("");
      setPendingQuote("");
      toast("评论已发送");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCommentBusy(false);
    }
  }

  async function exit() {
    if (dirty || phase === "saving") await save();
    onExit();
  }

  async function remove() {
    if (deleting === "idle") { setDeleting("confirm"); return; }
    if (deleting === "busy") return;
    setDeleting("busy");
    try {
      await api(`/api/docs/${initial.id}`, { method: "DELETE" });
      toast("文档已删除");
      onExit();
    } catch (e) {
      setPhase("error");
      setSaveError((e as Error).message);
      setDeleting("idle");
    }
  }

  const statusText = phase === "saving" ? "正在保存…"
    : phase === "error" ? `保存失败：${saveError || "请重试"}`
    : dirty ? "有改动，稍后自动保存…"
    : `已保存 · ${fmtTime(savedAt)}`;

  const sideWidth = commentsOpen ? 280 : toc.length >= 3 ? 176 : 0;

  return (
    <div className="ws-docs-editor">
      <div className="ws-docs-editor-head">
        <button className="ws-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => void exit()}>‹ 返回</button>
        <input
          className="ws-docs-title-input"
          value={title}
          maxLength={80}
          placeholder="未命名文档"
          aria-label="文档标题"
          onChange={(e) => setTitle(e.target.value)}
        />
        <select className="ws-select" style={{ width: "auto", maxWidth: 130, fontSize: 12, padding: "6px 8px" }}
          title="文档分组" aria-label="文档分组" value={folder}
          onChange={(e) => setFolder(e.target.value)}>
          <option value="">未分组</option>
          {[...new Set([...allFolders, folder].filter(Boolean))].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className={`ws-docs-save-state ${phase === "error" ? "is-error" : ""}`} role="status">{statusText}</span>
        <div className="ws-view-switch" role="group" aria-label="编辑或预览">
          <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>编辑</button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>预览</button>
        </div>
        <button className="ws-btn" style={{ padding: "6px 12px", fontSize: 12 }} title="文档评论"
          onClick={() => setCommentsOpen((v) => !v)}>
          💬{comments !== null && comments.length > 0 ? ` ${comments.length}` : ""}
        </button>
        <button className="ws-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setShowVersions(true)}><Icon name="list" size={13} /> 历史版本</button>
        {initial.canDelete && (
          <button className={`ws-btn ${deleting === "confirm" ? "danger" : ""}`} style={{ padding: "6px 12px", fontSize: 12 }} disabled={deleting === "busy"}
            onBlur={() => setDeleting("idle")} onClick={() => void remove()}>
            {deleting === "confirm" ? "确认删除？" : deleting === "busy" ? "删除中…" : "删除"}
          </button>
        )}
      </div>

      <div className={`ws-docs-editor-body ${sideWidth ? "with-side" : ""}`}>
        {mode === "edit" ? (
          <>
            <textarea
              className="ws-docs-textarea"
              value={content}
              placeholder="支持 Markdown：# 标题、**粗体**、`代码`、- 列表、> 引用、[链接](https://…)、[[E2E-002]] 引用任务，左写右览"
              aria-label="文档正文（Markdown）"
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
            <div className="ws-docs-preview-pane" aria-label="实时预览" ref={previewRef} onClick={onPreviewClick} onMouseUp={captureSelection}>
              {content.trim() ? (
                <article className="ws-docs-render" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
              ) : (
                <div className="ws-empty" style={{ margin: 24 }}>开始输入后这里会实时预览</div>
              )}
            </div>
          </>
        ) : (
          <div className="ws-docs-preview-pane single" aria-label="文档预览" ref={previewRef} onClick={onPreviewClick} onMouseUp={captureSelection}>
            {content.trim() ? (
              <article className="ws-docs-render" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
            ) : (
              <div className="ws-empty" style={{ margin: 24, maxWidth: 480 }}>这篇文档还是空的，切回「编辑」开始写作</div>
            )}
          </div>
        )}

        {sideWidth > 0 && (
          <aside className="ws-docs-side" style={{ width: sideWidth }} aria-label="目录与评论">
            {!commentsOpen && toc.length >= 3 && (
              <nav className="ws-doc-toc" aria-label="目录大纲">
                <div className="ws-doc-toc-head">目录</div>
                {toc.map((item) => (
                  <button key={item.id} style={{ paddingLeft: 6 + (item.level - 1) * 10 }}
                    onClick={() => previewRef.current?.querySelector(`#${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    {item.text}
                  </button>
                ))}
              </nav>
            )}
            {commentsOpen && (
              <div className="ws-doc-comments">
                <div className="ws-doc-toc-head">评论 {comments !== null ? `(${comments.length})` : ""}</div>
                <div className="ws-doc-comment-list">
                  {comments === null && <div className="ws-empty" style={{ padding: 16 }}>正在加载评论…</div>}
                  {comments?.length === 0 && <div className="ws-empty" style={{ padding: 16 }}>还没有评论。选中预览中的文字再评论，可带上引用。</div>}
                  {comments?.map((c) => (
                    <div key={c.id} className="ws-doc-comment">
                      <div className="ws-doc-comment-head">
                        <b>{c.mine ? "我" : c.author.displayName}</b>
                        <span>{fmtDateShort(c.createdAt)} {fmtTime(c.createdAt)}</span>
                      </div>
                      {c.quote && <blockquote className="ws-doc-comment-quote">{c.quote}</blockquote>}
                      <div className="ws-doc-comment-body">{c.content}</div>
                    </div>
                  ))}
                </div>
                <div className="ws-doc-comment-input">
                  {pendingQuote && (
                    <div className="ws-reply-banner">
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>引用：{pendingQuote}</span>
                      <button className="ws-icon-btn" style={{ width: 20, height: 20 }} onClick={() => setPendingQuote("")}><Icon name="x" size={12} /></button>
                    </div>
                  )}
                  <textarea rows={2} placeholder="评论…支持 @成员" value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitComment(); } }} />
                  <button className="ws-btn primary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={!commentText.trim() || commentBusy} onClick={() => void submitComment()}>
                    {commentBusy ? "发送中…" : "发送"}
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {showVersions && (
        <VersionsModal
          docId={initial.id}
          onClose={() => setShowVersions(false)}
          onRestored={applyRestored}
        />
      )}
    </div>
  );

  // 恢复版本：覆盖本地编辑状态并视为已保存，避免自动保存立即把旧内容再写一遍
  function applyRestored(doc: DocDetail) {
    setTitle(doc.title);
    setContent(doc.content);
    setFolder(doc.folder ?? "");
    setSavedSnapshot({ title: doc.title, content: doc.content, folder: doc.folder ?? "" });
    setSavedAt(doc.updatedAt);
    setPhase("saved");
    setSaveError("");
  }
}

function VersionsModal({ docId, onClose, onRestored }: { docId: number; onClose(): void; onRestored(doc: DocDetail): void }) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const reload = useCallback(() => {
    api<{ versions: DocVersion[] }>(`/api/docs/${docId}/versions`)
      .then((d) => { setVersions(d.versions); setError(""); })
      .catch((e: Error) => setError(e.message));
  }, [docId]);

  useEffect(() => { reload(); }, [reload]);

  function restore(versionId: number) {
    if (restoringId !== null) return;
    setRestoringId(versionId);
    api<{ doc: DocDetail }>(`/api/docs/${docId}/versions`, { method: "POST", json: { versionId } })
      .then((d) => { onRestored(d.doc); toast("已恢复到所选版本"); reload(); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRestoringId(null));
  }

  const viewing = versions?.find((v) => v.id === viewingId) ?? null;

  return (
    <Modal title="历史版本（每篇保留最近 20 版）" onClose={onClose}>
      {error && <div className="ws-error" role="alert">{error}</div>}
      {!versions && !error && <div className="ws-empty">正在加载版本…</div>}
      {versions && versions.length === 0 && <div className="ws-empty">还没有历史版本。第一次修改保存后，旧内容会自动进入历史。</div>}
      <div className="ws-doc-versions">
        {versions?.map((v) => (
          <div key={v.id} className="ws-doc-version">
            <div className="ws-doc-version-main">
              <b>{fmtDateShort(v.createdAt)} {fmtTime(v.createdAt)}</b>
              <small>{v.editorName ?? "未知成员"} 保存前快照 · {v.excerpt || "（空文档）"}</small>
            </div>
            <div className="ws-doc-version-actions">
              <button className="ws-btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setViewingId(viewingId === v.id ? null : v.id)}>{viewingId === v.id ? "收起" : "查看"}</button>
              <button className="ws-btn primary" style={{ padding: "5px 10px", fontSize: 12 }} disabled={restoringId !== null} onClick={() => restore(v.id)}>{restoringId === v.id ? "恢复中…" : "恢复此版"}</button>
            </div>
          </div>
        ))}
      </div>
      {viewing && (
        <div className="ws-doc-version-preview">
          <article className="ws-docs-render" dangerouslySetInnerHTML={{ __html: renderMarkdown(viewing.content) }} />
        </div>
      )}
    </Modal>
  );
}
