// 工作台首屏 A/B 测量：同一份生产构建，用 ?sched=legacy|priority 交替复测。
// 用法：
//   $env:DATABASE_URL='<隔离库>'; $env:WS_PERF_ORIGIN='http://localhost:3113'; node scripts/measure-workspace-open.mjs [对数]
// 说明：
//   - 生产模式下登录 POST 需要 HTTPS；本脚本直接在隔离库写入一条会话，用 Cookie 打开工作台，只测 GET 读取链路。
//   - 每个样本清浏览器缓存和 Cookie，重新导航到 /workspace?perf=1&sched=...，避免上一轮数据影响。
//   - 四点为：脚本就绪（工作台挂载）、身份确认（/api/auth/me 提交后）、选定默认项目（.ws-proj.active 出现）、
//     第一张任务卡（#ws-center .ws-task-card 出现）。
//   - /api/projects 从 Resource Timing 取 start / responseStart / responseEnd，用来区分"发得晚、服务端慢、数据到了没选定"。
//   - 每轮卡片出现后点一次"团队聊天"和"通知"，记录点击到内容出现的时间，检查卡顿是否被转移。
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

config({ path: ".env.local", quiet: true });

const origin = process.env.WS_PERF_ORIGIN ?? "http://localhost:3113";
const pairs = Math.max(3, Number(process.argv[2] ?? 12));
const warmupPairs = 2;
const edgePath = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("需要 DATABASE_URL（指向隔离测量库）");
const debugPort = Number(process.env.WS_PERF_DEBUG_PORT ?? 0) || (9300 + Math.floor(Math.random() * 300));

/* ---------- 隔离库会话：生产模式登录 POST 需要 HTTPS，这里直接写会话 ---------- */
const postgres = (await import("postgres")).default;
const sql = postgres(dbUrl, { max: 1, connect_timeout: 10 });
const sessionToken = "ws-perf-" + randomBytes(18).toString("hex");
try {
  const [user] = await sql`select id from users where email = 'test@stu.edu.cn'`;
  if (!user) throw new Error("隔离库里没有 test@stu.edu.cn");
  await sql`delete from sessions where token like 'ws-perf-%'`;
  await sql`insert into sessions (token, user_id, expires_at, last_active_at) values (${sessionToken}, ${user.id}, now() + interval '2 hours', now())`;
} finally {
  await sql.end();
}

/* ---------- Edge + CDP ---------- */
const profileDir = mkdtempSync(path.join(os.tmpdir(), "ws-perf-edge-"));
const edge = spawn(edgePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "about:blank",
], { windowsHide: true, stdio: "ignore" });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let version = null;
for (let i = 0; i < 100; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await pause(200); }
}
if (!version) throw new Error("Edge 无头浏览器没有启动");

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
};
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const { targetId } = await call("Target.createTarget", { url: "about:blank" });
const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
await call("Page.enable", {}, sessionId);
await call("Runtime.enable", {}, sessionId);
await call("Network.enable", {}, sessionId);
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
await call("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);

// DOM 观察点：选中项目、第一张卡、聊天消息、通知条目。以 DOM 出现为准，不依赖组件内部计时。
await call("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    window.__wsPerf = { cardAt: null, selectedAt: null, chatAt: null, notifAt: null, chatClickAt: null, notifClickAt: null };
    const record = () => {
      const now = performance.now();
      if (window.__wsPerf.selectedAt === null && document.querySelector(".ws-proj.active")) window.__wsPerf.selectedAt = now;
      if (window.__wsPerf.cardAt === null && document.querySelector("#ws-center .ws-task-card")) window.__wsPerf.cardAt = now;
      if (window.__wsPerf.chatAt === null && document.querySelector(".ws-msg")) window.__wsPerf.chatAt = now;
      if (window.__wsPerf.notifAt === null && document.querySelector(".ws-notif")) window.__wsPerf.notifAt = now;
    };
    new MutationObserver(record).observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", record);
  })();`,
}, sessionId);

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate failed");
  return result.result.value;
}

async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await evaluate(expression); if (value) return value; } catch { /* 导航中 */ }
    await pause(20);
  }
  throw new Error(`等待超时：${expression}`);
}

const collectExpression = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const marks = {};
  for (const m of performance.getEntriesByType("mark")) marks[m.name] = m.startTime;
  const resources = performance.getEntriesByType("resource")
    .filter((r) => r.name.includes("/api/"))
    .map((r) => { const u = new URL(r.name); return { path: u.pathname + u.search, start: r.startTime, responseStart: r.responseStart, responseEnd: r.responseEnd, duration: r.duration, bytes: r.encodedBodySize, transfer: r.transferSize }; });
  return JSON.stringify({
    nav: nav ? { domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : null,
    marks, resources, perf: window.__wsPerf,
    selected: document.querySelector(".ws-proj.active .ws-proj-name")?.textContent ?? null,
    taskCount: document.querySelectorAll("#ws-center .ws-task-card").length,
    firstTask: document.querySelector("#ws-center .ws-task-card .ws-task-title")?.textContent ?? null,
  });
})()`;

async function diagnose() {
  try {
    const state = await evaluate(`JSON.stringify({
      url: location.href, title: document.title, body: (document.body?.innerText ?? "").slice(0, 300),
      resources: performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/")).map((r) => new URL(r.name).pathname + ":" + Math.round(r.duration)),
    })`);
    let meStatus = "unavailable";
    try {
      const result = await call("Runtime.evaluate", {
        expression: "fetch('/api/auth/me').then((r) => r.status).catch((e) => 'ERR:' + e.message)",
        returnByValue: true, awaitPromise: true,
      }, sessionId);
      meStatus = result.result.value;
    } catch (error) { meStatus = String(error); }
    return `${state} me=${meStatus}`;
  } catch (error) { return String(error); }
}

async function runSampleWithTransfer(variant) {
  await call("Network.clearBrowserCookies", {}, sessionId);
  await call("Network.clearBrowserCache", {}, sessionId);
  await call("Network.setCookie", {
    name: "agile_session", value: sessionToken, url: origin, path: "/", httpOnly: true, secure: false, sameSite: "Lax",
  }, sessionId);
  await call("Page.navigate", { url: `${origin}/workspace?perf=1&sched=${variant}` }, sessionId);
  try {
    await waitFor("window.__wsPerf && window.__wsPerf.cardAt !== null", 20000);
  } catch (error) {
    process.stderr.write(`SAMPLE_FAIL ${variant} ${await diagnose()}\n`);
    throw error;
  }
  await pause(120);
  const base = JSON.parse(await evaluate(collectExpression));

  // 切聊天：只点顶栏「团队聊天」；观察 .ws-msg 出现。
  const chatClicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll(".ws-top-menu button")].find((b) => b.textContent.trim() === "团队聊天");
    if (!button) return false;
    window.__wsPerf.chatClickAt = performance.now();
    button.click();
    return true;
  })()`);
  let chatLatency = null;
  if (chatClicked) {
    try {
      await waitFor("window.__wsPerf.chatAt !== null", 6000);
      chatLatency = await evaluate("window.__wsPerf.chatAt - window.__wsPerf.chatClickAt");
    } catch { /* 聊天为空或加载失败，保留 null */ }
  }

  // 切通知：点图标栏「通知」；观察 .ws-notif 出现。
  const notifClicked = await evaluate(`(() => {
    const button = document.querySelector('.ws-rail button[title="通知"]');
    if (!button) return false;
    window.__wsPerf.notifClickAt = performance.now();
    button.click();
    return true;
  })()`);
  let notifLatency = null;
  if (notifClicked) {
    try {
      await waitFor("window.__wsPerf.notifAt !== null", 6000);
      notifLatency = await evaluate("window.__wsPerf.notifAt - window.__wsPerf.notifClickAt");
    } catch { /* 通知为空或加载失败，保留 null */ }
  }

  return { ...base, chatLatency, notifLatency };
}

const samples = { legacy: [], priority: [] };
const totalPairs = warmupPairs + pairs;
for (let pair = 0; pair < totalPairs; pair++) {
  const first = pair % 2 === 0 ? "legacy" : "priority";
  const second = first === "legacy" ? "priority" : "legacy";
  for (const variant of [first, second]) {
    process.stderr.write(`sample ${pair + 1}/${totalPairs} ${variant}\n`);
    const sample = await runSampleWithTransfer(variant);
    if (pair >= warmupPairs) samples[variant].push({ ...sample, pair: pair - warmupPairs });
  }
}

/* ---------- 统计 ---------- */
const round = (value) => Math.round(value * 100) / 100;
function stats(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { min: round(sorted[0]), median: round(median), p95: round(percentile(0.95)), max: round(sorted.at(-1)) };
}

function firstResource(sample, predicate) {
  return sample.resources.find((resource) => predicate(resource.path)) ?? null;
}

const derived = { legacy: [], priority: [] };
for (const variant of ["legacy", "priority"]) {
  for (const sample of samples[variant]) {
    const projects = firstResource(sample, (path) => path === "/api/projects");
    const tasks = firstResource(sample, (path) => path.startsWith("/api/tasks?projectId="));
    const script = sample.marks["ws:script"] ?? null;
    const auth = sample.marks["ws:auth"] ?? null;
    const selected = sample.perf.selectedAt ?? sample.marks["ws:selected"] ?? null;
    const card = sample.perf.cardAt ?? sample.marks["ws:card"] ?? null;
    derived[variant].push({
      pair: sample.pair,
      script, auth, selected, card,
      projectSelected: selected,
      firstCard: card,
      projectsStart: projects?.start ?? null,
      projectsTtfb: projects ? projects.responseStart - projects.start : null,
      projectsEnd: projects ? projects.responseEnd - projects.start : null,
      projectsBytes: projects?.bytes ?? null,
      authToProjectsStart: projects && auth !== null ? projects.start - auth : null,
      projectsEndToSelected: projects && selected !== null ? selected - projects.responseEnd : null,
      selectedToCard: selected !== null && card !== null ? card - selected : null,
      tasksStart: tasks?.start ?? null,
      tasksEnd: tasks ? tasks.responseEnd - tasks.start : null,
      requestsBeforeCard: sample.resources.filter((resource) => card !== null && resource.start < card).length,
      chatLatency: sample.chatLatency ?? null,
      notifLatency: sample.notifLatency ?? null,
      selectedName: sample.selected,
      taskCount: sample.taskCount,
      firstTask: sample.firstTask,
    });
  }
}

const metrics = [
  ["脚本就绪", "script"], ["身份确认", "auth"], ["选定默认项目", "projectSelected"], ["第一张任务卡", "firstCard"],
  ["projects 发出→TTFB", "projectsTtfb"], ["projects 总耗时", "projectsEnd"],
  ["auth→projects 发出", "authToProjectsStart"], ["projects 结束→选定", "projectsEndToSelected"],
  ["选定→第一张卡", "selectedToCard"], ["tasks 总耗时", "tasksEnd"],
  ["卡片后切聊天", "chatLatency"], ["卡片后切通知", "notifLatency"],
];

const report = { origin, pairs, samples: samples.legacy.length, generatedAt: new Date().toISOString(), derived, table: [], paired: [] };
console.log(`# 工作台首屏测量\n\n目标：${origin}　有效样本：${pairs} 对（预热 ${warmupPairs} 对已丢弃）\n`);
console.log("| 指标 | 旧调度 median | 旧 p95 | 新调度 median | 新 p95 | 配对差（旧-新）median |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const [label, key] of metrics) {
  const legacyValues = derived.legacy.map((row) => row[key]);
  const priorityValues = derived.priority.map((row) => row[key]);
  const legacyStats = stats(legacyValues);
  const priorityStats = stats(priorityValues);
  const paired = [];
  for (let i = 0; i < Math.min(derived.legacy.length, derived.priority.length); i++) {
    const a = derived.legacy[i][key];
    const b = derived.priority[i][key];
    if (typeof a === "number" && typeof b === "number") paired.push(a - b);
  }
  const pairedStats = stats(paired);
  const row = {
    metric: label, key,
    legacy: legacyStats, priority: priorityStats, pairedDiff: pairedStats,
    legacyValues: legacyValues.map((value) => (typeof value === "number" ? round(value) : null)),
    priorityValues: priorityValues.map((value) => (typeof value === "number" ? round(value) : null)),
  };
  report.table.push(row);
  console.log(`| ${label} | ${legacyStats?.median ?? "-"} | ${legacyStats?.p95 ?? "-"} | ${priorityStats?.median ?? "-"} | ${priorityStats?.p95 ?? "-"} | ${pairedStats?.median ?? "-"} |`);
}

const legacyRequests = stats(derived.legacy.map((row) => row.requestsBeforeCard));
const priorityRequests = stats(derived.priority.map((row) => row.requestsBeforeCard));
console.log(`\n卡片出现前已发出的 /api 请求数：旧调度 median ${legacyRequests?.median ?? "-"}，新调度 median ${priorityRequests?.median ?? "-"}。`);

const mismatches = [];
for (let i = 0; i < Math.min(derived.legacy.length, derived.priority.length); i++) {
  const a = derived.legacy[i], b = derived.priority[i];
  if (a.selectedName !== b.selectedName || a.taskCount !== b.taskCount || a.firstTask !== b.firstTask) {
    mismatches.push({ pair: i, legacy: { selectedName: a.selectedName, taskCount: a.taskCount, firstTask: a.firstTask }, priority: { selectedName: b.selectedName, taskCount: b.taskCount, firstTask: b.firstTask } });
  }
}
report.equivalence = { mismatches, ok: mismatches.length === 0 };
console.log(`两种调度最终内容一致：${mismatches.length === 0 ? "是" : `否（${mismatches.length} 对不一致）`}`);

const outputPath = path.join(process.cwd(), "docs", "workspace-loading-raw.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(`\n原始数据：${outputPath}`);

await call("Browser.close").catch(() => {});
await pause(500);
try { edge.kill(); } catch { /* 浏览器可能已退出 */ }
try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* Edge 可能还未完全退出 */ }
await sql`delete from sessions where token like 'ws-perf-%'`.catch(() => {});
process.exit(mismatches.length === 0 ? 0 : 1);
