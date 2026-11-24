import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readScheduleMode, initialBurst, projectOpenPlan, deferredWaves, viewResource, pollingPlan,
} from "../lib/workspace-schedule";

test("?sched=legacy 才走旧调度，其他情况默认新调度", () => {
  assert.equal(readScheduleMode("?sched=legacy"), "legacy");
  assert.equal(readScheduleMode("?perf=1&sched=legacy"), "legacy");
  assert.equal(readScheduleMode(""), "priority");
  assert.equal(readScheduleMode("?sched=priority"), "priority");
  assert.equal(readScheduleMode("?project=7"), "priority");
});

test("身份确认后：旧调度六并发，新调度只请求项目列表", () => {
  assert.deepEqual(initialBurst("legacy"), ["teams", "projects", "overview", "notifications", "myTasks", "dms"]);
  assert.deepEqual(initialBurst("priority"), ["projects"]);
});

test("选定项目后：旧调度五并发，新调度按当前分区只拉主资源", () => {
  assert.deepEqual(projectOpenPlan("legacy", "tasks"), {
    primary: ["detail", "tasks", "chat", "activities", "files"], secondary: [],
  });

  assert.deepEqual(projectOpenPlan("priority", "tasks"), { primary: ["tasks"], secondary: ["detail", "activities"] });
  assert.deepEqual(projectOpenPlan("priority", "chat"), { primary: ["chat"], secondary: ["tasks", "detail", "activities"] });
  assert.deepEqual(projectOpenPlan("priority", "space"), { primary: ["detail"], secondary: ["tasks", "activities"] });

  for (const focus of ["tasks", "chat", "space"] as const) {
    const plan = projectOpenPlan("priority", focus);
    assert.ok(!plan.primary.includes("files"), `${focus} 首屏不拉文件列表`);
    if (focus !== "chat") assert.ok(!plan.primary.includes("chat"), `${focus} 首屏不拉聊天记录`);
    for (const key of plan.secondary) assert.ok(!plan.primary.includes(key), `${focus} 主/次资源不重复`);
  }
});

test("首屏就绪后的补齐顺序：角标先于统计，团队最后", () => {
  assert.deepEqual(deferredWaves(), [["notifications", "dms"], ["overview", "myTasks"], ["teams"]]);
  const flat = deferredWaves().flat();
  assert.equal(flat[0], "notifications");
  assert.equal(flat.at(-1), "teams");
  assert.ok(!flat.includes("chat") && !flat.includes("files"), "聊天和文件不进入后台补齐");
});

test("菜单/分区对应的首屏必需资源", () => {
  assert.equal(viewResource("todos", "tasks"), "myTasks");
  assert.equal(viewResource("notifications", "tasks"), "notifications");
  assert.equal(viewResource("messages", "tasks"), "dms");
  assert.equal(viewResource("projectManagement", "tasks"), "projects");
  assert.equal(viewResource("teamManagement", "tasks"), "teams");
  assert.equal(viewResource("projects", "tasks"), "tasks");
  assert.equal(viewResource("projects", "chat"), "chat");
  assert.equal(viewResource("projects", "space"), null);
  assert.equal(viewResource("docs", "tasks"), null);
  assert.equal(viewResource("today", "tasks"), null);
});

test("新调度轮询：详情/日志始终在，聊天只在聊天分区", () => {
  assert.deepEqual(pollingPlan("priority", "projects", "tasks"), [
    { key: "detail", interval: 20000 }, { key: "activities", interval: 8000 },
  ]);
  assert.deepEqual(pollingPlan("priority", "projects", "chat"), [
    { key: "detail", interval: 20000 }, { key: "activities", interval: 8000 }, { key: "chat", interval: 8000 },
  ]);
  assert.deepEqual(pollingPlan("priority", "projects", "space"), [
    { key: "detail", interval: 20000 }, { key: "activities", interval: 8000 },
  ]);
  assert.deepEqual(pollingPlan("priority", "todos", "tasks"), []);
  assert.deepEqual(pollingPlan("legacy", "projects", "tasks"), [], "旧调度保持原轮询实现");
});
