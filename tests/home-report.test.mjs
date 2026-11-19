import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyReport, daysBetween, dueLabel } from "../lib/home-report.ts";

const base = {
  dateKey: "2026-11-19",
  dateText: "11月19日 星期四",
  userName: "306001",
  projectCount: 1,
  myTodo: 1,
  myDoing: 1,
  myDone: 1,
  deadlineToday: [],
  overdue: [],
  deadlineTomorrow: [],
  unreadDms: 0,
  unreadNotifications: 0,
  projects: [],
  milestonesUpcoming: [],
  mentionsToday: [],
};

test("daysBetween 与 dueLabel 的区间语义", () => {
  assert.equal(daysBetween("2026-11-19", "2026-11-19"), 0);
  assert.equal(daysBetween("2026-11-19", "2026-11-20"), 1);
  assert.equal(daysBetween("2026-11-19", "2026-11-18"), -1);
  assert.equal(dueLabel("2026-11-19", "2026-11-19"), "今天截止");
  assert.equal(dueLabel("2026-11-20", "2026-11-19"), "明天截止");
  assert.equal(dueLabel("2026-11-26", "2026-11-19"), "7 天后截止");
  assert.equal(dueLabel("2026-11-17", "2026-11-19"), "已逾期 2 天");
});

test("空工作区：头条引导创建项目，建议聚焦开始", () => {
  const r = buildDailyReport({ ...base, projectCount: 0 });
  assert.ok(r.headline.includes("还没有加入任何项目"));
  assert.ok(r.summary.includes("创建团队和项目"));
  assert.ok(r.focusItems[0].includes("创建第一个团队"));
});

test("今天截止与逾期进入头条、临近截止与建议排序", () => {
  const r = buildDailyReport({
    ...base,
    overdue: ["AGILE-003 晚交的周报"],
    deadlineToday: ["AGILE-001 设计登录页视觉稿"],
    deadlineTomorrow: ["AGILE-002 完成用户调研报告"],
  });
  assert.ok(r.headline.includes("已逾期"), "逾期优先出现在头条");
  const dl = r.sections.find((s) => s.key === "deadlines");
  assert.ok(dl.lines[0].includes("已逾期"), "临近截止第一行是逾期任务");
  assert.ok(dl.lines.some((l) => l.includes("今天截止")));
  assert.equal(r.focusItems[0], "先补上逾期的 AGILE-003 晚交的周报");
  assert.equal(r.focusItems[1], "优先完成 AGILE-001 设计登录页视觉稿");
  assert.equal(r.focusItems[2], "准备 AGILE-002 完成用户调研报告");
  assert.ok(r.focusItems.length <= 3);
});

test("全部完成时给出正反馈头条", () => {
  const r = buildDailyReport({ ...base, myTodo: 0, myDoing: 0, myDone: 4 });
  assert.ok(r.headline.includes("干得漂亮"));
});

test("项目动态行包含进度与今日计数", () => {
  const r = buildDailyReport({
    ...base,
    projects: [{ id: 1, name: "敏捷校园平台", taskTotal: 4, taskDone: 1, taskDoing: 1, createdToday: 2, completedToday: 1, messagesToday: 5, docsUpdatedToday: 1 }],
  });
  const pj = r.sections.find((s) => s.key === "projects");
  assert.ok(pj.lines[0].includes("25%"), "进度百分比 1/4");
  assert.ok(pj.lines[0].includes("新增 2"));
  assert.ok(pj.lines[0].includes("消息 5 条"));
  assert.ok(r.summary.includes("今日新增 2 个任务"));
});

test("提及与里程碑进入对应分节", () => {
  const r = buildDailyReport({
    ...base,
    mentionsToday: ["【敏捷校园平台】306002：@306001 看一下设计稿"],
    milestonesUpcoming: [{ projectName: "敏捷校园平台", title: "需求评审", dueOn: "2026-11-25" }],
  });
  assert.ok(r.sections.find((s) => s.key === "mentions").lines[0].includes("@306001"));
  const ms = r.sections.find((s) => s.key === "milestones");
  assert.ok(ms.lines[0].includes("需求评审"));
  assert.ok(ms.lines[0].includes("6 天后截止"));
});

test("无截止任务但有进行中任务时，建议推进手头工作", () => {
  const r = buildDailyReport({ ...base });
  assert.ok(r.focusItems[0].includes("推进手头"));
});
