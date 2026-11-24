// 首屏测量标记：只有带 ?perf=1 打开工作台时才记录，正常使用不产生额外开销。
// 时间点用 performance.mark，测量脚本从 Resource Timing 单独取 /api/projects 的 start/TTFB/end。
const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf");
const marked = new Set<string>();

export function perfMark(name: string, once = false) {
  if (!enabled || typeof performance === "undefined") return;
  if (once && marked.has(name)) return;
  marked.add(name);
  try { performance.mark(name); } catch { /* 老浏览器/隐私模式下忽略 */ }
}

/** 第一张任务卡挂载时记录一次；以 DOM 观察为准，这里是辅助标记。 */
export function perfMarkFirstCard() {
  perfMark("ws:card", true);
}
