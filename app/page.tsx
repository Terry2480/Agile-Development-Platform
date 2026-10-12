"use client";

// AgileCampus 工作空间（深色 · 按「同频」设计图）：状态中心 + 布局组装
// 数据全部来自后端 API（无演示数据）；登录守卫与 v1 一致
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, ApiError, uploadFile as apiUpload,
  type Me, type Team, type ProjectSummary, type ProjectDetail, type TaskItem,
  type ChatMessage, type ActivityItem, type FileItem, type NotificationItem, type Overview,
} from "@/lib/api-client";
import { WorkspaceContext, type WorkspaceStore, type RailView, type FocusSection, type ModalState } from "@/components/ws/shared";
import { IconRail } from "@/components/ws/IconRail";
import { ProjectSidebar } from "@/components/ws/ProjectSidebar";
import { TopBar } from "@/components/ws/TopBar";
import { TaskPanel, TodosView, NotificationsView, TaskDrawer, NewTaskModal } from "@/components/ws/TaskPanel";
import { ChatPanel } from "@/components/ws/ChatPanel";
import { ManagementPanel } from "@/components/ws/ManagementPanel";
import { ProjectActivitySidebar } from "@/components/ws/ProjectActivitySidebar";
import { SpacePanel, NewSprintModal, InviteModal } from "@/components/ws/SpacePanel";
import { NewTeamModal, NewProjectModal } from "@/components/ws/Modals";

import { RequestGate } from "@/lib/request-gate";
import { startPolling } from "@/lib/polling";

const projectResources = ["detail", "tasks", "chat", "activities", "files"];
const resourceNames: Record<string, string> = { projects: "项目列表", teams: "团队列表", overview: "统计", notifications: "通知", myTasks: "我的待办", detail: "项目详情", tasks: "项目任务", chat: "团队聊天", activities: "项目日志", files: "文件列表" };
type LoadState = { loading: boolean; loaded: boolean; error: string | null };

export default function WorkspacePage() {
  const router = useRouter();

  /* ---------- 登录守卫 ---------- */
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const authenticate = useCallback(async () => {
    setAuthLoading(true); setAuthError("");
    try { const d = await api<{ user: Me }>("/api/auth/me"); setMe(d.user); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login");
      else setAuthError((e as Error).message);
    } finally { setAuthLoading(false); }
  }, [router]);
  useEffect(() => { void authenticate(); }, [authenticate]);

  /* ---------- 状态 ---------- */
  const [railView, setRailView] = useState<RailView>("projects");
  const [focusSection, setFocusSection] = useState<FocusSection>("tasks");
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const [gate] = useState(() => new RequestGate());
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [notice, setNotice] = useState("");
  useEffect(() => () => gate.cancel(), [gate]);
  const selectProject = useCallback((id: number | null) => {
    if (selectedIdRef.current === id) return;
    gate.cancel(projectResources);
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetail(null); setTasks([]); setChat([]); setActivities([]); setFiles([]);
    setDrawerTaskId(null); setTaskSearch(""); setNotice("");
    setModal((m) => m?.type === "newTeam" || m?.type === "newProject" ? m : null);
    setLoads((prev) => {
      const next = { ...prev };
      for (const key of projectResources) next[key] = { loading: id !== null, loaded: false, error: null };
      return next;
    });
  }, [gate]);
  const loadResource = useCallback(async <T,>(key: string, path: string, commit: (data: T) => void) => {
    const request = gate.begin(key);
    setLoads((prev) => ({ ...prev, [key]: { loaded: prev[key]?.loaded ?? false, loading: true, error: null } }));
    try {
      const data = await api<T>(path, { signal: request.signal });
      if (!request.current()) return;
      commit(data);
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
      if (cur === null || !d.projects.some((p) => p.id === cur)) selectProject(d.projects[0]?.id ?? null);
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

  const refreshProjectData = useCallback(async () => {
    await Promise.all([refreshDetail(), refreshTasks(), refreshChat(), refreshActivities(), refreshFiles()]);
  }, [refreshDetail, refreshTasks, refreshChat, refreshActivities, refreshFiles]);

  // 初始加载 + 轻量轮询（通知/统计/我的任务）
  useEffect(() => {
    if (!me) return;
    Promise.all([refreshTeams(), refreshProjects(), refreshOverview(), refreshNotifications(), refreshMyTasks()]).catch(() => {});
    const stop = [
      ["notifications", refreshNotifications], ["overview", refreshOverview], ["myTasks", refreshMyTasks],
    ].map(([key, refresh]) => startPolling(() => gate.isPending(key as string) ? Promise.resolve() : (refresh as () => Promise<void>)(), 20000));
    return () => stop.forEach((cancel) => cancel());
  }, [me, gate, refreshTeams, refreshProjects, refreshOverview, refreshNotifications, refreshMyTasks]);

  // 切换项目时拉取项目数据
  useEffect(() => {
    if (!me || selectedId === null) {
      return;
    }
    refreshProjectData().catch(() => {});
  }, [me, selectedId, refreshProjectData]);

  // 聊天 / 日志轮询（8 秒，保证赞同、置顶与新消息同步）
  useEffect(() => {
    if (!me || selectedId === null) return;
    const stopChat = startPolling(() => gate.isPending("chat") ? Promise.resolve() : refreshChat(), 8000);
    const stopActivities = startPolling(() => gate.isPending("activities") ? Promise.resolve() : refreshActivities(), 8000);
    const stopDetail = startPolling(() => gate.isPending("detail") ? Promise.resolve() : refreshDetail(), 20000);
    return () => { stopChat(); stopActivities(); stopDetail(); };
  }, [me, selectedId, gate, refreshChat, refreshActivities, refreshDetail]);

  /* ---------- 动作 ---------- */
  const afterProjectMutation = useCallback(async () => {
    await afterSaved([refreshProjects(), refreshTeams(), refreshOverview()]);
  }, [refreshProjects, refreshTeams, refreshOverview, afterSaved]);

  const afterTaskMutation = useCallback(async () => {
    await afterSaved([refreshTasks(), refreshProjects(), refreshActivities(), refreshMyTasks(), refreshOverview()]);
  }, [refreshTasks, refreshProjects, refreshActivities, refreshMyTasks, refreshOverview, afterSaved]);

  const store: WorkspaceStore = useMemo(() => ({
    me: me!,
    railView, setRailView,
    focusSection, setFocusSection,
    teams, projects, selectedId, detail, tasks, myTasks, chat, activities, files,
    notifications, unreadCount, overview,
    taskSearch, setTaskSearch,
    selectProject,
    modal, openModal: setModal, closeModal: () => setModal(null),
    drawerTaskId,
    openTask: (id) => setDrawerTaskId(id),
    closeTask: () => setDrawerTaskId(null),
    refreshTeams, refreshProjects, refreshProjectData, refreshTasks, refreshChat, refreshActivities, refreshFiles, refreshNotifications, refreshMyTasks,

    async createTeam(name, description) {
      await api("/api/teams", { method: "POST", json: { name, description: description ?? null } });
      await afterProjectMutation();
    },
    async deleteWorkspaceItem(kind, id) {
      await api(`/api/${kind === "project" ? "projects" : "teams"}/${id}`, { method: "DELETE" });
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
    async createProject(teamId, name, key, description, courseName) {
      const d = await api<{ project: { id: number } }>("/api/projects", {
        method: "POST", json: { teamId, name, key, description: description ?? null, courseName: courseName ?? null },
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
      await afterSaved([refreshDetail(), refreshProjects()]);
    },
    async toggleStar(projectId) {
      await api(`/api/projects/${projectId}/star`, { method: "POST", json: {} });
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
    async toggleLike(messageId) {
      await api(`/api/chat/${messageId}/like`, { method: "POST", json: {} });
      await afterSaved([refreshChat()]);
    },
    async togglePin(messageId, pinned) {
      await api(`/api/chat/${messageId}/pin`, { method: "PUT", json: { pinned } });
      await afterSaved([refreshChat()]);
    },
    async uploadProjectFile(file) {
      const id = selectedIdRef.current;
      if (!id) throw new Error("请先选择项目");
      const d = await apiUpload<{ file: { originalName: string } }>(`/api/projects/${id}/files`, file);
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
  }), [
    me, railView, focusSection, teams, projects, selectedId, detail, tasks, myTasks, chat,
    activities, files, notifications, unreadCount, overview, taskSearch, modal, drawerTaskId,
    selectProject, refreshProjects, refreshProjectData, refreshTasks, refreshChat,
    refreshActivities, refreshFiles, refreshNotifications, refreshMyTasks, refreshDetail, refreshTeams, refreshOverview,
    afterProjectMutation, afterTaskMutation, afterSaved,
  ]);

  /* ---------- 渲染 ---------- */
  if (authLoading) return <div className="ws-empty" role="status">正在加载工作空间…</div>;
  if (!me) return <div className="ws-empty" role="alert">{authError || "正在前往登录页面…"}{authError && <button className="ws-btn" onClick={() => void authenticate()}>重试</button>}</div>;
  const retries: Record<string, () => Promise<void>> = { projects: refreshProjects, teams: refreshTeams, overview: refreshOverview, notifications: refreshNotifications, myTasks: refreshMyTasks, detail: refreshDetail, tasks: refreshTasks, chat: refreshChat, activities: refreshActivities, files: refreshFiles };
  const activeKey = railView === "todos" ? "myTasks" : railView === "notifications" ? "notifications" : railView === "projectManagement" ? "projects" : railView === "teamManagement" ? "teams" : focusSection === "tasks" ? "tasks" : focusSection === "chat" ? "chat" : "files";
  const initialPending = loads[activeKey] && !loads[activeKey].loaded && (loads[activeKey].loading || loads[activeKey].error);

  const project = projects.find((p) => p.id === selectedId);

  return (
    <WorkspaceContext.Provider value={store}>
      <div className="ws-app">
        <IconRail />
        {railView === "projects" && <ProjectSidebar />}

        <div className="ws-main">
          <TopBar />
          {notice && <div className="ws-error" role="status">{notice}<button className="ws-btn" onClick={() => setNotice("")}>关闭</button></div>}
          {Object.entries(loads).filter(([, state]) => state.error).map(([key, state]) => <div className="ws-error" role="alert" key={key}>{resourceNames[key]}加载失败：{state.error} <button className="ws-btn" disabled={state.loading} onClick={() => void retries[key]().catch(() => {})}>{state.loading ? "重试中…" : "重试"}</button></div>)}
          <div className="ws-body">
            <div className="ws-center" id="ws-center">
              {initialPending && <div className="ws-empty" role="status">{loads[activeKey].loading ? `正在加载${resourceNames[activeKey]}…` : "加载失败，请点击上方重试"}</div>}
              {!initialPending && railView === "projects" && focusSection === "tasks" && <TaskPanel key={selectedId} />}
              {railView === "projects" && focusSection === "chat" && !initialPending && <ChatPanel key={selectedId} />}
              {railView === "projects" && focusSection === "space" && !initialPending && <SpacePanel key={selectedId} />}
              {railView === "projectManagement" && <ManagementPanel kind="project" />}
              {railView === "teamManagement" && <ManagementPanel key="teams" kind="team" />}
              {railView === "todos" && !initialPending && <TodosView />}
              {railView === "notifications" && !initialPending && <NotificationsView />}
            </div>
            {railView === "projects" && <ProjectActivitySidebar />}
          </div>
          <div className="ws-statusbar">
            <span className="ws-dot" /> {Object.values(loads).some((s) => s.error) ? "部分数据加载失败" : "工作空间"}
            <span>· {project ? project.name : "未选择项目"}</span>
            <span>· {detail?.members.length ?? 0} 位成员</span>
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
    </WorkspaceContext.Provider>
  );
}
