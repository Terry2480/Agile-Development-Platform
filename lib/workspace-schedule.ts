// 工作台首屏请求调度：只描述"什么时候请求什么"，不碰接口、权限和项目选择规则。
// legacy 保留改动前的两次 Promise.all；priority 先加载当前面板，再在首屏就绪后补齐侧栏。
export type ScheduleMode = "legacy" | "priority";
export type ProjectFocus = "tasks" | "chat" | "space";
export type ResourceKey =
  | "projects"
  | "teams"
  | "overview"
  | "notifications"
  | "myTasks"
  | "dms"
  | "detail"
  | "tasks"
  | "chat"
  | "activities"
  | "files";

export const PROJECT_RESOURCES: readonly ResourceKey[] = ["detail", "tasks", "chat", "activities", "files"];

/** ?sched=legacy 时才走旧调度；默认新调度。 */
export function readScheduleMode(search: string): ScheduleMode {
  return new URLSearchParams(search).get("sched") === "legacy" ? "legacy" : "priority";
}

/** 身份确认后：旧调度一次发六个；新调度只等项目列表。 */
export function initialBurst(mode: ScheduleMode): ResourceKey[] {
  return mode === "legacy"
    ? ["teams", "projects", "overview", "notifications", "myTasks", "dms"]
    : ["projects"];
}

/**
 * 选定项目后：旧调度一次拉五个项目资源；新调度只拉当前面板的主资源，
 * 再把首屏右侧栏需要的任务/详情/日志作为第二轮补上（右侧栏进度依赖 tasks 和 detail）。
 * 聊天和文件不在这里拉：只有聊天分区才拉聊天，文件仍保持按需。
 */
export function projectOpenPlan(mode: ScheduleMode, focus: ProjectFocus): { primary: ResourceKey[]; secondary: ResourceKey[] } {
  if (mode === "legacy") {
    return { primary: [...PROJECT_RESOURCES], secondary: [] };
  }
  const primary: ResourceKey[] = focus === "chat" ? ["chat"] : focus === "space" ? ["detail"] : ["tasks"];
  const secondary = (["tasks", "detail", "activities"] as ResourceKey[]).filter((key) => !primary.includes(key));
  return { primary, secondary };
}

/** 首屏就绪后才补的用户级数据：角标先于统计，团队最后。 */
export function deferredWaves(): ResourceKey[][] {
  return [["notifications", "dms"], ["overview", "myTasks"], ["teams"]];
}

/** 某个菜单/分区要显示内容前，必须先加载的资源；返回 null 表示组件自己管理加载态。 */
export function viewResource(railView: string, focus: ProjectFocus): ResourceKey | null {
  if (railView === "todos") return "myTasks";
  if (railView === "notifications") return "notifications";
  if (railView === "messages") return "dms";
  if (railView === "projectManagement") return "projects";
  if (railView === "teamManagement") return "teams";
  if (railView === "projects") return focus === "tasks" ? "tasks" : focus === "chat" ? "chat" : null;
  return null;
}

/** 新调度下项目视图的轮询范围：详情/日志始终在右侧栏，聊天只在聊天分区轮询。 */
export function pollingPlan(mode: ScheduleMode, railView: string, focus: ProjectFocus): { key: ResourceKey; interval: number }[] {
  if (mode === "legacy" || railView !== "projects") return [];
  const plan: { key: ResourceKey; interval: number }[] = [
    { key: "detail", interval: 20000 },
    { key: "activities", interval: 8000 },
  ];
  if (focus === "chat") plan.push({ key: "chat", interval: 8000 });
  return plan;
}
