"use client";
import { resolveNotificationTarget } from "@/lib/notification-navigation";

// AgileCampus 工作空间（深色 · 按「同频」设计图）：状态中心 + 布局组装
// 数据全部来自后端 API（无演示数据）；登录守卫与 v1 一致
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, ApiError, uploadFile as apiUpload,
  type Me, type Team, type ProjectSummary, type ProjectDetail, type TaskItem,
  type ChatMessage, type ActivityItem, type FileItem, type NotificationItem, type Overview,
  type DmConversation,
} from "@/lib/api-client";
import { WorkspaceContext, type WorkspaceStore, type RailView, type FocusSection, type ModalState } from "@/components/ws/shared";
import { IconRail } from "@/components/ws/IconRail";
import { ProjectSidebar } from "@/components/ws/ProjectSidebar";
import { TopBar } from "@/components/ws/TopBar";
import { TaskPanel, TodosView, NotificationsView, TaskDrawer, NewTaskModal } from "@/components/ws/TaskPanel";
import { ChatPanel } from "@/components/ws/ChatPanel";
import { MessagesPanel } from "@/components/ws/MessagesPanel";
import { DocumentsPanel } from "@/components/ws/documents/DocumentsPanel";
import { TodayPanel } from "@/components/ws/TodayPanel";
import { ShortcutsPanel } from "@/components/ws/ShortcutsPanel";
import { WorkspaceShell } from "@/components/ws/WorkspaceShell";
import { ToastHost } from "@/components/ws/ToastHost";
import { CommandPalette } from "@/components/ws/CommandPalette";
import { TaskListSkeleton, ConversationSkeleton } from "@/components/ws/LoadingSkeleton";
import { toast } from "@/lib/toast";
import { ManagementPanel } from "@/components/ws/ManagementPanel";
import { ProjectActivitySidebar } from "@/components/ws/ProjectActivitySidebar";
import { SpacePanel, NewSprintModal, InviteModal } from "@/components/ws/SpacePanel";
import { NewTeamModal, NewProjectModal } from "@/components/ws/Modals";

import { RequestGate } from "@/lib/request-gate";
import { startPolling } from "@/lib/polling";
import {
  PROJECT_RESOURCES, deferredWaves, initialBurst, pollingPlan, projectOpenPlan, readScheduleMode, viewResource,
  type ResourceKey, type ScheduleMode,
} from "@/lib/workspace-schedule";
import { perfMark } from "@/lib/workspace-perf";

const projectResources = PROJECT_RESOURCES;
const resourceNames: Record<string, string> = { projects: "项目列表", teams: "团队列表", overview: "统计", notifications: "通知", myTasks: "我的待办", detail: "项目详情", tasks: "项目任务", chat: "团队聊天", activities: "项目日志", files: "文件列表", dms: "私信列表" };
type LoadState = { loading: boolean; loaded: boolean; error: string | null };

export default function WorkspacePage() {
  const router = useRouter();
  // 同一份生产构建里用 ?sched=legacy 复现旧调度；默认走新调度。
  const [scheduleMode] = useState<ScheduleMode>(() =>
    typeof window === "undefined" ? "priority" : readScheduleMode(window.location.search),
  );

  /* ---------- 登录守卫 ---------- */
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const authenticate = useCallback(async () => {
    setAuthLoading(true); setAuthError("");
    try { const d = await api<{ user: Me }>("/api/auth/me"); setMe(d.user); perfMark("ws:auth", true); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
      else setAuthError((e as Error).message);
    } finally { setAuthLoading(false); }
  }, [router]);
  useEffect(() => { void authenticate(); }, [authenticate]);

  /* ---------- 状态 ---------- */
  const [railView, setRailView] = useState<RailView>("projects");
  const [focusSection, setFocusSection] = useState<FocusSection>("tasks");
  // 窄窗口（<960）下中间的项目列表收起为抽屉；最左侧功能图标栏始终保留
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [myTasks, setMyTasks] = useState<TaskItem[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [dmUnreadTotal, setDmUnreadTotal] = useState(0);
  const [dmTargetId, setDmTargetId] = useState<number | null>(null);
  const [dmsLoaded, setDmsLoaded] = useState(false);
  const [docTarget, setDocTarget] = useState<{ id: number; n: number } | null>(null);
  const docTargetNonce = useRef(0); // 每次跳转递增，重复打开同一篇文档也能触发（修复死点击）
  const [overview, setOverview] = useState<Overview | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const focusSectionRef = useRef(focusSection);
  const railViewRef = useRef(railView);
  const [gate] = useState(() => new RequestGate());
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const loadsRef = useRef(loads);
  const [deferredReady, setDeferredReady] = useState(false);
  const deferredStartedRef = useRef(false);
  const [notice, setNotice] = useState("");
  // 先于下方所有读取 ref 的 effect 声明，保证同一轮提交里 ref 已是新值。
  useEffect(() => { loadsRef.current = loads; }, [loads]);
  useEffect(() => { focusSectionRef.current = focusSection; railViewRef.current = railView; }, [focusSection, railView]);
  useEffect(() => () => gate.cancel(), [gate]);
  useEffect(() => { perfMark("ws:script", true); }, []);

  /* ---------- 首页深链：#hash 直达模块，?project=ID 直达项目 ---------- */
  const deepProjectRef = useRef<number | null>(null);
  useEffect(() => {
    const viewMap: Record<string, { rail?: RailView; focus?: FocusSection }> = {
      projects: { rail: "projectManagement" },
      teams: { rail: "teamManagement" },
      docs: { rail: "docs" },
      tasks: { rail: "projects", focus: "tasks" },
      chat: { rail: "projects", focus: "chat" },
      space: { rail: "projects", focus: "space" },
      todos: { rail: "todos" },
      messages: { rail: "messages" },
      notifications: { rail: "notifications" },
    };
    const hit = viewMap[decodeURIComponent(window.location.hash.slice(1))];
    if (hit?.rail) setRailView(hit.rail);
    if (hit?.focus) setFocusSection(hit.focus);
    const pid = Number(new URLSearchParams(window.location.search).get("project"));
    if (Number.isInteger(pid) && pid > 0) deepProjectRef.current = pid;
  }, []);

  const selectProject = useCallback((id: number | null) => {
    gate.cancel(["notificationNavigation"]);
    if (selectedIdRef.current === id) return;
    gate.cancel(projectResources);
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetail(null); setTasks([]); setChat([]); setActivities([]); setFiles([]);
    setDrawerTaskId(null); setTaskSearch(""); setNotice("");
    setSidebarOpen(false);
    setModal((m) => m?.type === "newTeam" || m?.type === "newProject" ? m : null);
    setLoads((prev) => {
      const next = { ...prev };
      // 旧调度保留"五个资源同时开始"的加载标记；新调度只标记未加载，等真正请求时再置 loading。
      for (const key of projectResources) next[key] = { loading: scheduleMode === "legacy" && id !== null, loaded: false, error: null };
      return next;
    });
  }, [gate, scheduleMode]);
  const loadResource = useCallback(async <T,>(key: string, path: string, commit: (data: T) => void) => {
    const request = gate.begin(key);
    setLoads((prev) => ({ ...prev, [key]: { loaded: prev[key]?.loaded ?? false, loading: true, error: null } }));
    try {
      const data = await api<T>(path, { signal: request.signal });
      if (!request.current()) return;
      commit(data);
      if (key === "projects") perfMark("ws:projects", true);
      if (key === "tasks") perfMark("ws:tasks", true);
      setLoads((prev) => ({ ...prev, [key]: { loaded: true, loading: false, error: null } }));
    } catch (e) {
      if (!request.current()) return;
      setLoads((prev) => ({ ...prev, [key]: { loaded: prev[key]?.loaded ?? false, loading: false, error: (e as Error).message } }));
      throw e;
    } finally { request.finish(); }
  }, [gate]);
  const afterSaved = useCallback(async (requests: Promise<void>[]) => {
    const results = await Promise.allSettled(requests);
    if (results.some((r) => r.status === "rejected")) setNotice("操作已成功，但部分数据刷新失败。请使用下方重试按钮刷新，无需再次提交。");
  }, []);

  /* ---------- 数据加载 ---------- */
  const refreshProjects = useCallback(async () => {
    await loadResource<{ projects: ProjectSummary[] }>("projects", "/api/projects", (d) => {
      setProjects(d.projects);
      const cur = selectedIdRef.current;
      const deep = deepProjectRef.current;
      deepProjectRef.current = null;
      if (deep !== null && d.projects.some((p) => p.id === deep)) selectProject(deep);
      else if (cur === null || !d.projects.some((p) => p.id === cur)) selectProject(d.projects[0]?.id ?? null);
    });
  }, [loadResource, selectProject]);
  const refreshTeams = useCallback(() => loadResource<{ teams: Team[] }>("teams", "/api/teams", (d) => setTeams(d.teams)), [loadResource]);
  const refreshOverview = useCallback(() => loadResource<{ overview: Overview }>("overview", "/api/overview", (d) => setOverview(d.overview)), [loadResource]);
  const refreshNotifications = useCallback(() => loadResource<{ notifications: NotificationItem[]; unreadCount: number }>("notifications", "/api/notifications", (d) => { setNotifications(d.notifications); setUnreadCount(d.unreadCount); }), [loadResource]);
  const refreshMyTasks = useCallback(() => loadResource<{ tasks: TaskItem[] }>("myTasks", "/api/tasks?mine=1", (d) => setMyTasks(d.tasks)), [loadResource]);
  const refreshTasks = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id !== null) await loadResource<{ tasks: TaskItem[] }>("tasks", `/api/tasks?projectId=${id}`, (d) => setTasks(d.tasks));
  }, [loadResource]);
  const refreshDetail = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id !== null) await loadResource<ProjectDetail>("detail", `/api/projects/${id}`, setDetail);
  }, [loadResource]);
  const refreshChat = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id !== null) await loadResource<{ messages: ChatMessage[] }>("chat", `/api/projects/${id}/chat`, (d) => setChat(d.messages));
  }, [loadResource]);
  const refreshActivities = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id !== null) await loadResource<{ activities: ActivityItem[] }>("activities", `/api/projects/${id}/activities?limit=30`, (d) => setActivities(d.activities));
  }, [loadResource]);
  const refreshFiles = useCallback(async () => {
    const id = selectedIdRef.current;
    if (id !== null) await loadResource<{ files: FileItem[] }>("files", `/api/projects/${id}/files`, (d) => setFiles(d.files));
  }, [loadResource]);
  const refreshDms = useCallback(async () => {
    await loadResource<{ conversations: DmConversation[]; unreadTotal: number }>("dms", "/api/dm", (d) => {
      setDmConversations(d.conversations);
      setDmUnreadTotal(d.unreadTotal);
      setDmsLoaded(true);
    });
  }, [loadResource]);

  const refreshProjectData = useCallback(async () => {
    await Promise.all([refreshDetail(), refreshTasks(), refreshChat(), refreshActivities(), refreshFiles()]);
  }, [refreshDetail, refreshTasks, refreshChat, refreshActivities, refreshFiles]);

  const refreshResource = useCallback((key: ResourceKey): Promise<void> => {
    switch (key) {
      case "projects": return refreshProjects();
      case "teams": return refreshTeams();
      case "overview": return refreshOverview();
      case "notifications": return refreshNotifications();
      case "myTasks": return refreshMyTasks();
      case "dms": return refreshDms();
      case "detail": return refreshDetail();
      case "tasks": return refreshTasks();
      case "chat": return refreshChat();
      case "activities": return refreshActivities();
      case "files": return refreshFiles();
    }
  }, [refreshProjects, refreshTeams, refreshOverview, refreshNotifications, refreshMyTasks, refreshDms, refreshDetail, refreshTasks, refreshChat, refreshActivities, refreshFiles]);

  // 按需加载：已加载、进行中或已失败的资源不自动重发；失败由顶部错误条的重试按钮处理，避免自动重试循环。
  const ensureResource = useCallback((key: ResourceKey) => {
    const state = loadsRef.current[key];
    if (state?.loaded || state?.loading || state?.error || gate.isPending(key)) return;
    void refreshResource(key).catch(() => {});
  }, [gate, refreshResource]);

  // 初始加载：旧调度保留六并发；新调度只等项目列表。
  useEffect(() => {
    if (!me) return;
    if (scheduleMode === "legacy") {
      Promise.all(initialBurst(scheduleMode).map((key) => refreshResource(key))).catch(() => {});
      return;
    }
    void refreshProjects().catch(() => {});
  }, [me, scheduleMode, refreshProjects, refreshResource]);

  // 旧调度的用户级轮询保持原样。
  useEffect(() => {
    if (!me || scheduleMode !== "legacy") return;
    const stop = [
      ["notifications", refreshNotifications], ["overview", refreshOverview], ["myTasks", refreshMyTasks],
      ["dms", refreshDms],
    ].map(([key, refresh]) => startPolling(() => gate.isPending(key as string) ? Promise.resolve() : (refresh as () => Promise<void>)(), 20000));
    return () => stop.forEach((cancel) => cancel());
  }, [me, scheduleMode, gate, refreshNotifications, refreshOverview, refreshMyTasks, refreshDms]);

  // 选定项目：旧调度五并发；新调度先当前分区主资源，再补右侧栏的详情/日志。
  useEffect(() => {
    if (!me || selectedId === null) return;
    if (scheduleMode === "legacy") {
      refreshProjectData().catch(() => {});
      return;
    }
    const plan = projectOpenPlan(scheduleMode, focusSectionRef.current);
    const projectId = selectedId;
    void (async () => {
      await Promise.allSettled(plan.primary.map((key) => refreshResource(key)));
      if (railViewRef.current === "projects" && selectedIdRef.current === projectId) {
        // 右侧栏的任务/详情/日志与视图按需 effect 可能同时想发；ensureResource 会复用进行中的请求。
        for (const key of plan.secondary) ensureResource(key);
      }
    })();
  }, [me, selectedId, scheduleMode, refreshProjectData, refreshResource, ensureResource]);

  useEffect(() => { if (selectedId !== null) perfMark("ws:selected", true); }, [selectedId]);

  // 菜单按需：切到还没加载的面板时，复用进行中的请求或现发一次。
  useEffect(() => {
    if (scheduleMode !== "priority" || !me) return;
    const key = viewResource(railView, focusSection);
    if (key) ensureResource(key);
    if (railView === "projects" && selectedId !== null) {
      const primaryKey = focusSection === "chat" ? "chat" : focusSection === "space" ? "detail" : "tasks";
      // 右侧栏进度同时依赖 tasks 和 detail；等主资源落定后再补，避免和第一张卡抢同一轮请求。
      if (loads[primaryKey]?.loaded || loads[primaryKey]?.error) {
        ensureResource("detail");
        ensureResource("activities");
        if (focusSection !== "tasks") ensureResource("tasks");
      }
    }
    if (railView === "projectManagement") ensureResource("teams");
    if (railView === "today") {
      ensureResource("overview");
      ensureResource("dms");
    }
  }, [scheduleMode, me, railView, focusSection, selectedId, loads, ensureResource]);

  // 首屏就绪后的用户级补齐：角标 → 统计/待办 → 团队。
  const primaryKey = viewResource(railView, focusSection);
  const primaryState = primaryKey ? loads[primaryKey] : undefined;
  const deferredEligible = scheduleMode === "priority" && !!me && !!loads.projects?.loaded
    && (selectedId === null || primaryKey === null || !!primaryState?.loaded || !!primaryState?.error);
  useEffect(() => {
    if (!deferredEligible || deferredStartedRef.current) return;
    let frame = 0;
    let timer = 0;
    const start = () => {
      if (deferredStartedRef.current) return;
      deferredStartedRef.current = true;
      perfMark("ws:deferred-start", true);
      // 用户可能已经点开某个面板并先发了请求；这里复用/跳过，避免 abort 后重发。
      const fill = (key: ResourceKey) => {
        const state = loadsRef.current[key];
        if (state?.loaded || state?.loading || state?.error || gate.isPending(key)) return Promise.resolve();
        return refreshResource(key);
      };
      void (async () => {
        for (const wave of deferredWaves()) {
          await Promise.allSettled(wave.map(fill));
        }
        perfMark("ws:deferred-done", true);
        setDeferredReady(true);
      })();
    };
    frame = window.requestAnimationFrame(() => { timer = window.setTimeout(start, 0); });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [deferredEligible, refreshResource, gate]);

  // 新调度：首屏补齐后再启动用户级轮询。
  useEffect(() => {
    if (scheduleMode !== "priority" || !me || !deferredReady) return;
    const stop = [
      ["notifications", refreshNotifications], ["overview", refreshOverview], ["myTasks", refreshMyTasks],
      ["dms", refreshDms],
    ].map(([key, refresh]) => startPolling(() => gate.isPending(key as string) ? Promise.resolve() : (refresh as () => Promise<void>)(), 20000));
    return () => stop.forEach((cancel) => cancel());
  }, [scheduleMode, me, deferredReady, gate, refreshNotifications, refreshOverview, refreshMyTasks, refreshDms]);

  // 旧调度：项目数据轮询与文件库同步保持原样。
  useEffect(() => {
    if (!me || selectedId === null || scheduleMode !== "legacy") return;
    const stopChat = startPolling(() => gate.isPending("chat") ? Promise.resolve() : refreshChat(), 8000);
    const stopActivities = startPolling(() => gate.isPending("activities") ? Promise.resolve() : refreshActivities(), 8000);
    const stopDetail = startPolling(() => gate.isPending("detail") ? Promise.resolve() : refreshDetail(), 20000);
    const syncFiles = () => {
      if (document.visibilityState === "hidden" || gate.isPending("files")) return Promise.resolve();
      return refreshFiles();
    };
    const stopFiles = startPolling(syncFiles, 20000);
    const onFilesVisible = () => { void syncFiles().catch(() => {}); };
    window.addEventListener("focus", onFilesVisible);
    document.addEventListener("visibilitychange", onFilesVisible);
    return () => {
      stopChat(); stopActivities(); stopDetail(); stopFiles();
      window.removeEventListener("focus", onFilesVisible);
      document.removeEventListener("visibilitychange", onFilesVisible);
    };
  }, [me, selectedId, scheduleMode, gate, refreshChat, refreshActivities, refreshDetail, refreshFiles]);

  // 新调度：只轮询当前视图可见的项目数据，聊天不进任务/概览视图。
  useEffect(() => {
    if (scheduleMode !== "priority" || !me || selectedId === null || railView !== "projects") return;
    const stops = pollingPlan(scheduleMode, railView, focusSection).map(({ key, interval }) =>
      startPolling(() => gate.isPending(key) ? Promise.resolve() : refreshResource(key), interval));
    return () => stops.forEach((stop) => stop());
  }, [scheduleMode, me, selectedId, railView, focusSection, gate, refreshResource]);


  /* ---------- 动作 ---------- */
  const afterProjectMutation = useCallback(async () => {
    await afterSaved([refreshProjects(), refreshTeams(), refreshOverview()]);
  }, [refreshProjects, refreshTeams, refreshOverview, afterSaved]);

  const afterTaskMutation = useCallback(async () => {
    await afterSaved([refreshTasks(), refreshProjects(), refreshActivities(), refreshMyTasks(), refreshOverview()]);
  }, [refreshTasks, refreshProjects, refreshActivities, refreshMyTasks, refreshOverview, afterSaved]);

  // 只把 loaded 布尔暴露给组件：loading 翻转不改变 store，避免整棵工作台跟着重渲染。
  const loadedSignature = useMemo(() => Object.keys(loads).filter((key) => loads[key].loaded).sort().join("|"), [loads]);
  const loaded = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const key of loadedSignature ? loadedSignature.split("|") : []) map[key] = true;
    return map;
  }, [loadedSignature]);

  const store: WorkspaceStore = useMemo(() => ({
    me: me!,
    railView, setRailView: (view) => { gate.cancel(["notificationNavigation"]); setSidebarOpen(false); setRailView(view); },
    focusSection, setFocusSection: (section) => { gate.cancel(["notificationNavigation"]); setFocusSection(section); },
    sidebarOpen, setSidebarOpen,
    teams, projects, selectedId, detail, tasks, myTasks, chat, activities, files,
    notifications, unreadCount, overview,
    dmConversations, dmUnreadTotal, dmTargetId, dmsLoaded,
    loaded, ensureResource,
    refreshDms, docTarget,
    openDoc: (id) => { gate.cancel(["notificationNavigation"]); setDocTarget({ id, n: ++docTargetNonce.current }); setRailView("docs"); },
    taskSearch, setTaskSearch,
    selectProject,
    openDmConversation: (id) => { gate.cancel(["notificationNavigation"]); setDmTargetId(id); setRailView("messages"); },
    async openDmWithPeer(peerId) {
      const d = await api<{ conversation: { id: number } }>("/api/dm", { method: "POST", json: { peerId } });
      await afterSaved([refreshDms()]);
      gate.cancel(["notificationNavigation"]);
      setDmTargetId(d.conversation.id);
      setRailView("messages");
    },
    async hideDmConversation(id) {
      await api(`/api/dm/${id}/hide`, { method: "PUT", json: {} });
      await afterSaved([refreshDms()]);
      setDmTargetId((current) => current === id ? null : current);
    },
    async deleteDmConversation(id) {
      await api(`/api/dm/${id}`, { method: "DELETE" });
      await afterSaved([refreshDms(), refreshNotifications()]);
      setDmTargetId((current) => current === id ? null : current);
    },
    async updateDmSettings(id, patch) {
      await api(`/api/dm/${id}/settings`, { method: "PUT", json: patch });
      await afterSaved([refreshDms()]);
    },
    modal, openModal: setModal, closeModal: () => setModal(null),
    drawerTaskId,
    openTask: (id) => { gate.cancel(["notificationNavigation"]); setDrawerTaskId(id); },
    closeTask: () => setDrawerTaskId(null),
    refreshTeams, refreshProjects, refreshProjectData, refreshTasks, refreshChat, refreshActivities, refreshFiles, refreshNotifications, refreshMyTasks,

    async createTeam(name, description) {
      await api("/api/teams", { method: "POST", json: { name, description: description ?? null } });
      await afterProjectMutation();
    },
    async deleteWorkspaceItem(kind, id, confirmation) {
      await api(`/api/${kind === "project" ? "projects" : "teams"}/${id}`, { method: "DELETE", ...(confirmation ? { json: confirmation } : {}) });
      toast(`已删除${kind === "project" ? "项目" : "团队"}`);
      const removesSelection = kind === "project"
        ? selectedIdRef.current === id
        : projects.some((p) => p.id === selectedIdRef.current && p.teamId === id);
      if (removesSelection) {
        selectProject(null);
        setDetail(null); setTasks([]); setChat([]); setActivities([]); setFiles([]);
      }
      // 删除已成功，立即移除本地列表；刷新失败不应让用户再次删除。
      setProjects((items) => items.filter((p) => kind === "project" ? p.id !== id : p.teamId !== id));
      if (kind === "team") setTeams((items) => items.filter((t) => t.id !== id));
      await afterSaved([
        refreshProjects(), refreshTeams(), refreshOverview(), refreshMyTasks(), refreshNotifications(),
      ]);
    },
    async createProject(teamId, name, key, description, courseName, templateSet) {
      const d = await api<{ project: { id: number } }>("/api/projects", {
        method: "POST", json: { teamId, name, key, description: description ?? null, courseName: courseName ?? null, templateSet },
      });
      await afterSaved([refreshProjects()]);
      selectProject(d.project.id);
    },
    async createTask(input) {
      await api("/api/tasks", { method: "POST", json: input });
      await afterTaskMutation();
    },
    async updateTask(id, patch) {
      await api(`/api/tasks/${id}`, { method: "PUT", json: patch });
      await afterTaskMutation();
    },
    async deleteTask(id) {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      setTasks((items) => items.filter((t) => t.id !== id));
      await afterSaved([refreshTasks(), refreshProjects(), refreshActivities(), refreshMyTasks(), refreshOverview(), refreshFiles()]);
    },
    async createSprint(input) {
      const id = selectedIdRef.current;
      if (!id) return;
      await api(`/api/projects/${id}/sprints`, { method: "POST", json: input });
      await afterSaved([refreshDetail(), refreshProjects()]);
    },
    async completeSprint(sprintId) {
      await api(`/api/sprints/${sprintId}`, { method: "PUT", json: { status: "completed" } });
      await afterSaved([refreshDetail(), refreshProjects()]);
    },
    async inviteMember(email) {
      const d = detail;
      if (!d) return;
      await api(`/api/teams/${d.team.id}/members`, { method: "POST", json: { email } });
      toast("成员已加入团队");
      await afterSaved([refreshDetail(), refreshProjects()]);
    },
    async toggleStar(projectId) {
      const wasStarred = projects.some((p) => p.id === projectId && p.starred);
      await api(`/api/projects/${projectId}/star`, { method: "POST", json: {} });
      toast(wasStarred ? "已取消收藏" : "已收藏项目");
      await afterSaved([refreshProjects(), refreshDetail()]);
    },
    async sendChat(content, opts) {
      const id = selectedIdRef.current;
      if (!id) return;
      await api(`/api/projects/${id}/chat`, {
        method: "POST",
        json: { content, replyToId: opts?.replyToId ?? null, taskId: opts?.taskId ?? null },
      });
      await afterSaved([refreshChat()]);
    },
    async toggleLike(messageId, emoji) {
      await api(`/api/chat/${messageId}/like`, { method: "POST", json: { emoji: emoji ?? "👍" } });
      await afterSaved([refreshChat()]);
    },
    async togglePin(messageId, pinned) {
      await api(`/api/chat/${messageId}/pin`, { method: "PUT", json: { pinned } });
      await afterSaved([refreshChat()]);
    },
    async uploadProjectFile(file) {
      const id = selectedIdRef.current;
      if (!id) throw new Error("请先选择项目");
      // 聊天输入区的文件上传：chatFile=1 同时生成聊天文件消息（QQ 式留在聊天记录）
      const d = await apiUpload<{ file: { originalName: string } }>(`/api/projects/${id}/files`, file, undefined, undefined, { chatFile: "1" });
      await afterSaved([refreshFiles()]);
      return d.file.originalName;
    },
    async withdrawFile(id) {
      await api(`/api/files/${id}`, { method: "DELETE" });
      setFiles((items) => items.filter((f) => f.id !== id));
      await afterSaved([refreshFiles(), refreshActivities()]);
    },
    async uploadTaskFile(taskId, file) {
      const id = selectedIdRef.current;
      if (!id) throw new Error("请先选择项目");
      await apiUpload(`/api/projects/${id}/files`, file, taskId);
      await afterSaved([refreshFiles()]);
    },
    async markRead(ids) {
      await api("/api/notifications", { method: "PUT", json: ids?.length ? { ids } : { all: true } });
      await afterSaved([refreshNotifications()]);
    },
    async openNotification(notification) {
      const request = gate.begin("notificationNavigation");
      try {
        const target = await resolveNotificationTarget(notification, request.signal);
        if (!request.current()) return false;
        if (target && target.section !== "dm" && target.section !== "docs" && !projects.some((project) => project.id === target.projectId)) {
          await loadResource<{ projects: ProjectSummary[] }>("projects", "/api/projects", (data) => setProjects(data.projects));
          if (!request.current()) return false;
        }
        let readFailed = false;
        if (!notification.read) {
          try { await api("/api/notifications", { method: "PUT", json: { ids: [notification.id] } }); }
          catch { readFailed = true; }
        }
        if (!request.current()) return false;
        if (!target) {
          void refreshNotifications().catch(() => {});
          throw new Error("这条通知没有可打开的关联内容。");
        }
        if (target.section === "dm") {
          setDmTargetId(target.dmConversationId);
          setRailView("messages");
        } else if (target.section === "docs") {
          setDocTarget({ id: target.docId, n: ++docTargetNonce.current });
          setRailView("docs");
        } else {
          selectProject(target.projectId);
          setRailView("projects"); setFocusSection(target.section); setTaskSearch("");
          setDrawerTaskId(target.taskId ?? null);
        }
        if (readFailed) setNotice("内容已打开，但未能标记已读，请稍后重试。");
        void refreshNotifications().catch(() => {});
        return true;
      } catch (error) {
        if (!request.current()) return false;
        throw error;
      } finally { request.finish(); }
    },
  }), [
    me, railView, focusSection, sidebarOpen, teams, projects, selectedId, detail, tasks, myTasks, chat,
    activities, files, notifications, unreadCount, overview, dmConversations, dmUnreadTotal, dmTargetId, dmsLoaded, docTarget,
    taskSearch, modal, drawerTaskId,
    selectProject, refreshProjects, refreshProjectData, refreshTasks, refreshChat,
    refreshActivities, refreshFiles, refreshNotifications, refreshMyTasks, refreshDetail, refreshTeams, refreshOverview, refreshDms,
    afterProjectMutation, afterTaskMutation, afterSaved,
    gate,
    loadResource,
    loaded, ensureResource,
  ]);

  /* ---------- 渲染 ---------- */
  if (authLoading) return <div className="ws-empty" role="status">正在加载工作空间…</div>;
  if (!me) return <div className="ws-empty" role="alert">{authError || "正在前往登录页面…"}{authError && <button className="ws-btn" onClick={() => void authenticate()}>重试</button>}</div>;
  const retries: Record<string, () => Promise<void>> = { projects: refreshProjects, teams: refreshTeams, overview: refreshOverview, notifications: refreshNotifications, myTasks: refreshMyTasks, detail: refreshDetail, tasks: refreshTasks, chat: refreshChat, activities: refreshActivities, files: refreshFiles, dms: refreshDms };
  const activeKey = viewResource(railView, focusSection);
  const activeState = activeKey ? loads[activeKey] : undefined;
  const centerManaged = railView !== "messages" && railView !== "docs" && railView !== "today";
  // 项目列表已加载但一个项目都没有时，任务/聊天分区显示空态，而不是永远转圈。
  const noProject = selectedId === null && (activeKey === "tasks" || activeKey === "chat");
  const initialPending = centerManaged && activeKey !== null && !activeState?.loaded && !(noProject && loads.projects?.loaded);
  const detailState = loads.detail;

  const project = projects.find((p) => p.id === selectedId);

  return (
    <WorkspaceContext.Provider value={store}>
      <WorkspaceShell>
        <div className={`ws-app${sidebarOpen ? " sidebar-open" : ""}`}>
        <IconRail />
        {railView === "projects" && <ProjectSidebar />}
        {railView === "projects" && sidebarOpen && (
          <button className="ws-sidebar-backdrop" aria-label="关闭项目列表" onClick={() => setSidebarOpen(false)} />
        )}

        <div className="ws-main">
          <TopBar />
          {notice && <div className="ws-error" role="status">{notice}<button className="ws-btn" onClick={() => setNotice("")}>关闭</button></div>}
          {Object.entries(loads).filter(([, state]) => state.error).map(([key, state]) => <div className="ws-error" role="alert" key={key}>{resourceNames[key]}加载失败：{state.error} <button className="ws-btn" disabled={state.loading} onClick={() => void retries[key]().catch(() => {})}>{state.loading ? "重试中…" : "重试"}</button></div>)}
          <div className="ws-body">
            <div className="ws-center" id="ws-center">
              {initialPending && centerManaged && activeKey && (activeState?.error
                ? <div className="ws-empty" role="alert">加载失败，请点击上方重试</div>
                : activeKey === "tasks" ? <TaskListSkeleton />
                : activeKey === "chat" ? <ConversationSkeleton rows={5} />
                : <div className="ws-empty" role="status">正在加载{resourceNames[activeKey]}…</div>)}
              {!initialPending && railView === "projects" && focusSection === "tasks" && <TaskPanel key={selectedId} />}
              {railView === "projects" && focusSection === "chat" && !initialPending && <ChatPanel key={selectedId} />}
              {railView === "projects" && focusSection === "space" && !initialPending && <SpacePanel key={selectedId} />}
              {railView === "projectManagement" && <ManagementPanel kind="project" />}
              {railView === "teamManagement" && <ManagementPanel key="teams" kind="team" />}
              {railView === "todos" && !initialPending && <TodosView />}
              {railView === "notifications" && !initialPending && <NotificationsView />}
              {railView === "messages" && <MessagesPanel />}
              {railView === "docs" && <DocumentsPanel />}
              {railView === "today" && <TodayPanel />}
            </div>
            {railView === "projects" && <ProjectActivitySidebar />}
          </div>
          <div className="ws-statusbar">
            <span className="ws-dot" /> {Object.values(loads).some((s) => s.error) ? "部分数据加载失败" : "工作空间"}
            <span>· {project ? project.name : "未选择项目"}</span>
            <span>· {detailState?.loaded ? `${detail?.members.length ?? 0} 位成员` : detailState?.error ? "成员数未知" : "成员加载中…"}</span>
            <span style={{ marginLeft: "auto" }}>AgileCampus 敏捷校园</span>
          </div>
        </div>
      </div>

      <TaskDrawer key={`${selectedId}-${drawerTaskId}`} />

      {modal?.type === "newTeam" && <NewTeamModal onClose={() => setModal(null)} />}
      {modal?.type === "newProject" && <NewProjectModal onClose={() => setModal(null)} />}
      {modal?.type === "newTask" && (selectedId ? <NewTaskModal onClose={() => setModal(null)} /> : null)}
      {modal?.type === "newSprint" && (selectedId ? <NewSprintModal onClose={() => setModal(null)} /> : null)}
      {modal?.type === "invite" && (detail ? <InviteModal onClose={() => setModal(null)} /> : null)}
      </WorkspaceShell>

      <ToastHost />
      <CommandPalette />
      <ShortcutsPanel />
    </WorkspaceContext.Provider>
  );
}
