"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Tab = "overview" | "tasks" | "documents" | "timeline";
type DocumentMode = "edit" | "preview";

type DemoDocument = {
  id: string;
  title: string;
  kind: string;
  updatedAt: string;
  content: string;
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "项目概览" },
  { id: "tasks", label: "任务看板" },
  { id: "documents", label: "项目资料" },
  { id: "timeline", label: "时间线" },
];

const TASKS = [
  { id: "task-1", title: "完成学生访谈提纲", owner: "林晓", status: "done", due: "已完成" },
  { id: "task-2", title: "整理竞品与需求分析", owner: "陈一", status: "doing", due: "本周五" },
  { id: "task-3", title: "完成项目首页交互稿", owner: "周宁", status: "doing", due: "下周一" },
  { id: "task-4", title: "准备阶段汇报材料", owner: "全体成员", status: "todo", due: "下周三" },
];

const INITIAL_DOCUMENTS: DemoDocument[] = [
  {
    id: "doc-proposal",
    title: "项目开题",
    kind: "开题材料",
    updatedAt: "今天 16:20",
    content:
      "# 校园项目协作平台\n\n## 要解决的问题\n学生的课程、大创和科研项目分散在群聊、表格和网盘中，过程资料难以持续沉淀。\n\n## 预期成果\n形成一个面向学生项目的任务、资料和阶段节点工作台。",
  },
  {
    id: "doc-meeting",
    title: "第三次组会纪要",
    kind: "会议纪要",
    updatedAt: "昨天 21:10",
    content:
      "# 第三次组会纪要\n\n日期：本周一\n参与成员：林晓、陈一、周宁\n\n## 决策\n1. 先完成学生端项目工作台\n2. 资料按项目归档，不再依赖群文件\n\n## 待办任务\n- 补齐首页交互稿\n- 确认阶段汇报时间",
  },
  {
    id: "doc-weekly",
    title: "第 4 周周报",
    kind: "周报",
    updatedAt: "上周五 18:00",
    content:
      "# 第 4 周周报\n\n## 当前进展\n已完成用户访谈和核心流程梳理，正在制作项目工作台原型。\n\n## 遇到的问题\n学生项目的周期差异较大，需要同时兼容短周期课程项目和长期大创项目。\n\n## 下周计划\n完成任务看板、项目资料和阶段时间线。",
  },
];

const STATUS_LABEL: Record<string, string> = {
  todo: "待开始",
  doing: "进行中",
  done: "已完成",
};

const STATUS_TONE: Record<string, string> = {
  todo: "bg-low-soft text-low",
  doing: "bg-primary-soft text-primary",
  done: "bg-done/12 text-done",
};

export default function DemoPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [documents, setDocuments] = useState(INITIAL_DOCUMENTS);
  const [selectedDocumentId, setSelectedDocumentId] = useState(INITIAL_DOCUMENTS[0].id);
  const [documentMode, setDocumentMode] = useState<DocumentMode>("edit");
  const [taskFilter, setTaskFilter] = useState("all");
  const [saved, setSaved] = useState(false);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0];
  const visibleTasks = useMemo(
    () =>
      taskFilter === "all" ? TASKS : TASKS.filter((task) => task.status === taskFilter),
    [taskFilter],
  );

  function updateDocumentContent(content: string) {
    setSaved(false);
    setDocuments((current) =>
      current.map((document) =>
        document.id === selectedDocument.id ? { ...document, content } : document,
      ),
    );
  }

  function createDocument() {
    const document: DemoDocument = {
      id: `doc-${Date.now()}`,
      title: "新建项目资料",
      kind: "自定义",
      updatedAt: "刚刚",
      content: "# 新建项目资料\n\n记录你的项目过程、讨论和阶段成果。",
    };
    setDocuments((current) => [document, ...current]);
    setSelectedDocumentId(document.id);
    setDocumentMode("edit");
    setSaved(false);
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/login" className="flex shrink-0 items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-base font-bold text-white shadow-sm">
              A
            </span>
            <span className="font-display text-lg font-semibold text-ink">AgileCampus</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-ink-faint sm:inline">本地演示数据</span>
            <Link href="/login" className="ac-btn-ghost">
              返回登录
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="ac-card overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ac-badge bg-accent-soft text-accent">大创项目</span>
                <span className="ac-badge bg-done/12 text-done">进行中</span>
                <span className="text-xs text-ink-faint">学生项目工作台演示</span>
              </div>
              <h1 className="mt-3 truncate font-display text-3xl font-semibold text-ink">
                校园项目协作平台
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
                把任务、讨论、阶段资料和最终成果放在同一个项目空间里。
              </p>
            </div>
            <div className="min-w-48">
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <span>项目完成度</span>
                <strong className="text-primary">64%</strong>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
                <div className="h-full w-[64%] rounded-full bg-done" />
              </div>
              <p className="mt-2 text-right text-xs text-ink-faint">第 4 周 · 预计还剩 8 周</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 sm:px-5" aria-label="演示项目导航">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`shrink-0 border-b-2 px-3 py-3 text-sm ${
                  tab === item.id
                    ? "border-primary font-medium text-primary"
                    : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
                }`}
                aria-current={tab === item.id ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </section>

        {tab === "overview" && <Overview onOpen={(nextTab) => setTab(nextTab)} />}

        {tab === "tasks" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-semibold text-ink">任务看板</h2>
                <p className="mt-1 text-sm text-ink-soft">让每个人都知道下一步该做什么。</p>
              </div>
              <div className="flex rounded-field border border-line-strong bg-surface p-0.5">
                {[
                  ["all", "全部"],
                  ["todo", "待开始"],
                  ["doing", "进行中"],
                  ["done", "已完成"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTaskFilter(value)}
                    className={`rounded px-3 py-1.5 text-xs ${
                      taskFilter === value ? "bg-primary text-white" : "text-ink-soft"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {["todo", "doing", "done"].map((status) => (
                <div key={status} className="min-h-52 rounded-card border border-line bg-sunken/45 p-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold text-ink">{STATUS_LABEL[status]}</h3>
                    <span className="text-xs text-ink-faint">
                      {visibleTasks.filter((task) => task.status === status).length}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {visibleTasks
                      .filter((task) => task.status === status)
                      .map((task) => (
                        <li key={task.id} className="ac-card p-3">
                          <p className="text-sm font-medium text-ink">{task.title}</p>
                          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-faint">
                            <span>{task.owner}</span>
                            <span>{task.due}</span>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "documents" && (
          <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="ac-card h-fit overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">项目资料</h2>
                  <p className="mt-0.5 text-xs text-ink-faint">{documents.length} 篇资料</p>
                </div>
                <button type="button" onClick={createDocument} className="ac-btn-ghost px-2.5 py-1.5">
                  新建
                </button>
              </div>
              <div className="p-2">
                <ul className="space-y-1">
                  {documents.map((document) => (
                    <li key={document.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDocumentId(document.id);
                          setDocumentMode("edit");
                          setSaved(false);
                        }}
                        className={`w-full rounded-field px-3 py-2 text-left ${
                          selectedDocument.id === document.id
                            ? "bg-primary-soft text-primary"
                            : "text-ink-soft hover:bg-sunken hover:text-ink"
                        }`}
                      >
                        <span className="block truncate text-sm font-medium">{document.title}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-faint">
                          {document.kind} · {document.updatedAt}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
            <div className="ac-card overflow-hidden">
              <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-xl font-semibold text-ink">
                    {selectedDocument.title}
                  </h2>
                  <p className="mt-1 text-xs text-ink-faint">
                    {selectedDocument.kind} · {saved ? "已保存到本地演示" : "本地编辑"}
                  </p>
                </div>
                <div className="flex rounded-field border border-line-strong p-0.5">
                  <button
                    type="button"
                    onClick={() => setDocumentMode("edit")}
                    className={`rounded px-3 py-1.5 text-xs ${
                      documentMode === "edit" ? "bg-primary text-white" : "text-ink-soft"
                    }`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocumentMode("preview")}
                    className={`rounded px-3 py-1.5 text-xs ${
                      documentMode === "preview" ? "bg-primary text-white" : "text-ink-soft"
                    }`}
                  >
                    预览
                  </button>
                </div>
              </header>
              <div className="p-5">
                {documentMode === "edit" ? (
                  <textarea
                    value={selectedDocument.content}
                    onChange={(event) => updateDocumentContent(event.target.value)}
                    className="min-h-[28rem] w-full resize-y rounded-field border border-line-strong bg-surface p-4 font-mono text-sm leading-6 text-ink outline-none transition focus:border-primary focus:ring-4 focus:ring-primary-ring"
                  />
                ) : (
                  <div className="min-h-[28rem] whitespace-pre-wrap rounded-field bg-sunken/50 p-5 text-sm leading-7 text-ink">
                    {selectedDocument.content}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-faint">演示模式会保留当前页面内的编辑结果。</p>
                  <button type="button" onClick={() => setSaved(true)} className="ac-btn">
                    保存资料
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "timeline" && <Timeline />}
      </div>
    </main>
  );
}

function Overview({ onOpen }: { onOpen: (tab: Tab) => void }) {
  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="进行中任务" value="2" detail="共 4 项任务" />
        <Metric label="项目资料" value="3" detail="本周更新 2 篇" />
        <Metric label="下个节点" value="8 天" detail="完成阶段汇报" />
        <Metric label="项目成员" value="6 人" detail="学生 5 人 · 指导 1 人" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="ac-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">下一步</h2>
              <p className="mt-1 text-sm text-ink-soft">项目当前最需要推进的工作。</p>
            </div>
            <button type="button" onClick={() => onOpen("tasks")} className="ac-btn-ghost">
              查看任务
            </button>
          </div>
          <ul className="mt-5 divide-y divide-line">
            {TASKS.filter((task) => task.status !== "done")
              .slice(0, 3)
              .map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{task.title}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {task.owner} · {task.due}
                    </p>
                  </div>
                  <span className={`ac-badge ${STATUS_TONE[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                </li>
              ))}
          </ul>
        </section>
        <section className="ac-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">最近资料</h2>
              <p className="mt-1 text-sm text-ink-soft">把讨论和过程留下来。</p>
            </div>
            <button type="button" onClick={() => onOpen("documents")} className="ac-btn-ghost">
              打开资料
            </button>
          </div>
          <ul className="mt-5 space-y-3">
            {INITIAL_DOCUMENTS.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{document.title}</p>
                  <p className="mt-1 text-xs text-ink-faint">{document.kind}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">{document.updatedAt}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="ac-card p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-faint">{detail}</p>
    </div>
  );
}

function Timeline() {
  const stages = [
    ["已完成", "用户调研与问题定义", "第 1-2 周", "done"],
    ["进行中", "核心流程与交互设计", "第 3-5 周", "doing"],
    ["待开始", "开发、测试与阶段汇报", "第 6-8 周", "todo"],
    ["待开始", "成果整理与最终展示", "第 9-12 周", "todo"],
  ];

  return (
    <section className="ac-card p-5 sm:p-7">
      <div>
        <h2 className="font-display text-2xl font-semibold text-ink">项目时间线</h2>
        <p className="mt-1 text-sm text-ink-soft">用阶段节点承接课程项目和长期项目的节奏。</p>
      </div>
      <ol className="mt-8 grid gap-0 md:grid-cols-4">
        {stages.map(([status, title, period, tone], index) => (
          <li key={title} className="relative border-l border-line pb-7 pl-6 last:pb-0 md:border-l-0 md:border-t md:pb-0 md:pl-0 md:pt-6">
            <span
              className={`absolute -left-1.5 top-0 h-3 w-3 rounded-full border-2 border-surface md:-top-1.5 md:left-0 ${
                tone === "done" ? "bg-done" : tone === "doing" ? "bg-primary" : "bg-low"
              }`}
            />
            {index < stages.length - 1 && (
              <span className="absolute bottom-0 left-[-1px] top-3 w-px bg-line md:bottom-auto md:left-3 md:right-0 md:top-[-1px] md:h-px md:w-auto" />
            )}
            <span className={`ac-badge ${STATUS_TONE[tone]}`}>{status}</span>
            <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-xs text-ink-faint">{period}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
