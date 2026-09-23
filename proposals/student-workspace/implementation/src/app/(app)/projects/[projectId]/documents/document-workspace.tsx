"use client";

import { useActionState, useState } from "react";
import {
  createDocumentAction,
  deleteDocumentAction,
  updateDocumentAction,
  type DocumentActionState,
} from "./actions";
import type { DocumentKind } from "@/db/schema";
import { DOCUMENT_KIND_LABEL, DOCUMENT_TEMPLATES } from "@/lib/document-templates";

type DocumentItem = {
  id: string;
  title: string;
  kind: string;
  content: string;
  updatedAt: string;
};

export function DocumentWorkspace({
  projectId,
  canWrite,
  documents: initialDocuments,
}: {
  projectId: string;
  canWrite: boolean;
  documents: DocumentItem[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialDocuments[0]?.id ?? null);
  const [newKind, setNewKind] = useState<DocumentKind>("custom");
  const selected = initialDocuments.find((document) => document.id === selectedId) ?? null;

  const [createState, createAction, creating] = useActionState<DocumentActionState, FormData>(
    async (previous, formData) => {
      const result = await createDocumentAction(previous, formData);
      if (result && "ok" in result && result.id) {
        setSelectedId(result.id);
        setNewKind("custom");
      }
      return result;
    },
    null,
  );
  const [updateState, updateAction, updating] = useActionState<DocumentActionState, FormData>(
    updateDocumentAction,
    null,
  );
  const [deleteState, deleteAction, deleting] = useActionState<DocumentActionState, FormData>(
    async (previous, formData) => {
      const result = await deleteDocumentAction(previous, formData);
      if (result && "ok" in result) {
        const deletedId = formData.get("documentId");
        const nextDocument = initialDocuments.find(
          (document) => document.id !== deletedId,
        );
        setSelectedId(nextDocument?.id ?? null);
      }
      return result;
    },
    null,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="ac-card h-fit overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">项目文档</h2>
            <p className="mt-0.5 text-xs text-ink-faint">{initialDocuments.length} 篇资料</p>
          </div>
          {canWrite && <span className="text-xs text-primary">可编辑</span>}
        </div>
        <div className="max-h-[32rem] overflow-y-auto p-2">
          {initialDocuments.length === 0 ? (
            <p className="p-3 text-sm text-ink-soft">还没有项目资料。</p>
          ) : (
            <ul className="space-y-1">
              {initialDocuments.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(document.id)}
                    className={`w-full rounded-field px-3 py-2 text-left transition-colors ${
                      document.id === selectedId
                        ? "bg-primary-soft text-primary"
                        : "text-ink-soft hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{document.title}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {DOCUMENT_KIND_LABEL[document.kind as DocumentKind] ?? "自定义"} · {formatUpdatedAt(document.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canWrite && (
          <form action={createAction} className="space-y-2 border-t border-line p-3">
            <p className="text-xs font-medium text-ink-soft">新建资料</p>
            <input type="hidden" name="projectId" value={projectId} />
            <input
              name="title"
              placeholder="例如：第三次组会纪要"
              className="ac-field text-sm"
              required
            />
            <select
              name="kind"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as DocumentKind)}
              className="ac-field text-sm"
            >
              <option value="custom">自定义资料</option>
              <option value="proposal">开题材料</option>
              <option value="meeting">会议纪要</option>
              <option value="weekly">项目周报</option>
              <option value="research">研究记录</option>
            </select>
            {newKind !== "custom" && (
              <p className="text-[11px] leading-5 text-ink-faint">
                创建后会自动带入「{DOCUMENT_KIND_LABEL[newKind]}」结构，可直接填写。
              </p>
            )}
            {createState && "error" in createState && (
              <p className="text-xs text-high">{createState.error}</p>
            )}
            <button disabled={creating} className="ac-btn w-full px-3 py-2 text-sm">
              {creating ? "创建中…" : "新建资料"}
            </button>
          </form>
        )}
      </aside>

      <section className="ac-card min-h-[34rem] overflow-hidden">
        {selected ? (
          <DocumentEditor
            key={selected.id}
            projectId={projectId}
            canWrite={canWrite}
            document={selected}
            updateAction={updateAction}
            updateState={updateState}
            updating={updating}
            deleteAction={deleteAction}
            deleteState={deleteState}
            deleting={deleting}
          />
        ) : (
          <EmptyDocumentState canWrite={canWrite} />
        )}
      </section>
    </div>
  );
}

function DocumentEditor({
  projectId,
  canWrite,
  document,
  updateAction,
  updateState,
  updating,
  deleteAction,
  deleteState,
  deleting,
}: {
  projectId: string;
  canWrite: boolean;
  document: DocumentItem;
  updateAction: (formData: FormData) => void;
  updateState: DocumentActionState;
  updating: boolean;
  deleteAction: (formData: FormData) => void;
  deleteState: DocumentActionState;
  deleting: boolean;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);

  return (
    <>
      <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {canWrite ? (
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full bg-transparent font-display text-xl font-semibold text-ink outline-none"
              aria-label="文档标题"
            />
          ) : (
            <h2 className="truncate font-display text-xl font-semibold text-ink">{title}</h2>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {DOCUMENT_KIND_LABEL[document.kind as DocumentKind] ?? "自定义资料"} · 最近更新 {formatUpdatedAt(document.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-field border border-line-strong p-0.5" aria-label="文档查看模式">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`rounded px-2.5 py-1 text-xs ${mode === "edit" ? "bg-primary text-white" : "text-ink-soft"}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`rounded px-2.5 py-1 text-xs ${mode === "preview" ? "bg-primary text-white" : "text-ink-soft"}`}
            >
              预览
            </button>
          </div>
        </div>
      </header>

      <div className="p-5">
        {mode === "edit" && canWrite ? (
          <form action={updateAction} className="space-y-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="documentId" value={document.id} />
            <input type="hidden" name="title" value={title} />
            <textarea
              name="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-[25rem] w-full resize-y rounded-field border border-line-strong bg-surface p-4 font-mono text-sm leading-6 text-ink outline-none transition focus:border-primary focus:ring-4 focus:ring-primary-ring"
              placeholder={
                document.kind === "custom"
                  ? "从这里开始记录项目内容…"
                  : DOCUMENT_TEMPLATES[document.kind as DocumentKind]
              }
            />
            {updateState && "error" in updateState && (
              <p className="text-sm text-high">{updateState.error}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-faint">支持标题、列表和分段文本。</p>
              <button disabled={updating} className="ac-btn px-4 py-2 text-sm">
                {updating ? "保存中…" : "保存文档"}
              </button>
            </div>
          </form>
        ) : (
          <div className="min-h-[25rem] whitespace-pre-wrap rounded-field bg-sunken/50 p-5 text-sm leading-7 text-ink">
            {content || "这篇资料还没有内容。"}
          </div>
        )}

        {canWrite && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!confirm("确认删除这篇资料？此操作不可恢复。")) event.preventDefault();
            }}
            className="mt-5 flex items-center justify-between border-t border-line pt-4"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="documentId" value={document.id} />
            <span className="text-xs text-ink-faint">删除后无法恢复</span>
            <div className="flex items-center gap-2">
              {deleteState && "error" in deleteState && (
                <span className="text-xs text-high">{deleteState.error}</span>
              )}
              <button disabled={deleting} className="text-xs text-high underline">
                {deleting ? "删除中…" : "删除资料"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function EmptyDocumentState({ canWrite }: { canWrite: boolean }) {
  return (
    <div className="grid min-h-[34rem] place-items-center p-8 text-center">
      <div>
        <p className="font-display text-xl font-semibold text-ink">还没有选中的资料</p>
        <p className="mt-2 text-sm text-ink-soft">
          {canWrite ? "从左侧新建一篇资料，开始沉淀项目过程。" : "项目成员还没有创建项目资料。"}
        </p>
      </div>
    </div>
  );
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
