import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyReport } from "../lib/home-report.ts";

const base = {
  weekStart: "2026-11-16",
  weekEnd: "2026-11-22",
  weekLabelText: "11月16日 - 11月22日",
  userName: "306001",
  projectCount: 1,
  projects: [
    { name: "敏捷校园平台", created: 3, completed: 2, messages: 42, docsUpdated: 1, taskTotal: 4, taskDone: 3 },
  ],
  completedThisWeek: 2,
  createdThisWeek: 3,
  messagesThisWeek: 42,
  upcoming: ["AGILE-004 撰写项目总结文档（2026-11-26 截止）"],
  completedTitles: ["AGILE-003 实现日历组件"],
  unreadDms: 2,
};

test("周报头条与汇总", () => {
  const r = buildWeeklyReport(base);
  assert.ok(r.headline.includes("完成 2 项"));
  assert.ok(r.headline.includes("42 条协作消息"));
  assert.ok(r.summary.includes("整体完成度 75%"));
  assert.ok(r.summary.includes("协作最活跃：敏捷校园平台"));
});

test("项目动态行包含进度与周计数，完成清单缩进展示", () => {
  const r = buildWeeklyReport(base);
  assert.ok(r.lines[0].includes("进度 3/4"));
  assert.ok(r.lines[0].includes("本周新增 3 · 完成 2"));
  assert.ok(r.lines.join("\n").includes("本周完成："));
  assert.ok(r.lines.join("\n").includes("✓ AGILE-003 实现日历组件"));
});

test("下周关注：截止任务优先，其次未读私信，最后兜底", () => {
  const r = buildWeeklyReport(base);
  assert.ok(r.nextWeekFocus[0].includes("AGILE-004"));
  const noUpcoming = buildWeeklyReport({ ...base, upcoming: [] });
  assert.ok(noUpcoming.nextWeekFocus[0].includes("未读私信"));
  const neither = buildWeeklyReport({ ...base, upcoming: [], unreadDms: 0 });
  assert.ok(neither.nextWeekFocus[0].includes("挑一件事"));
});

test("空项目周报引导创建", () => {
  const r = buildWeeklyReport({ ...base, projectCount: 0, projects: [] });
  assert.ok(r.headline.includes("暂无项目动态"));
});
