"use client";

// AgileCampus 工作空间（深色 · 按「同频」设计图）：状态中心 + 布局组装
// 数据全部来自后端 API（无演示数据）；登录守卫与 v1 一致
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, uploadFile as apiUpload,
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

export default function WorkspacePage() {
  const router = useRouter();

  /* ---------- 登录守卫 ---------- */
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    api<{ user: Me }>("/api/auth/me")
      .then((d) => setMe(d.user))
      .catch(() => router.replace("/login"))
      .finally(() => setAuthLoading(false));
  }, [router]);

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
  selectedIdRef.current = selectedId;

  /* ---------- 数据加载 ---------- */
  const refreshProjects = useCallback(async () => {
    const d = await api<{ projects: ProjectSummary[] }>("/api/projects");
    setProjects(d.projects);
    setSelectedId((cur) => (cur && d.projects.some((p) => p.id === cur) ? cur : d.projects[0]?.id ?? null));
  }, []);

  const refreshTeams = useCallback(async () => {
    const d = await api<{ teams: Team[] }>("/api/teams");
    setTeams(d.teams);
  }, []);

  const refreshOverview = useCallback(async () => {
    const d = await api<{ overview: Overview }>("/api/overview");
    setOverview(d.overview);
  }, []);

  const refreshNotifications = useCallback(async () => {
    const d = await api<{ notifications: NotificationItem[]; unreadCount: number }>("/api/notifications");
    setNotifications(d.notifications);
    setUnreadCount(d.unreadCount);
  }, []);

  const refreshMyTasks = useCallback(async () => {
    const d = await api<{ tasks: TaskItem[] }>("/api/tasks?mine=1");
    setMyTasks(d.tasks);
  }, []);

  const refreshTasks = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return setTasks([]);
    const d = await api<{ tasks: TaskItem[] }>(`/api/tasks?projectId=${id}`);
    setTasks(d.tasks);
  }, []);

  const refreshDetail = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return setDetail(null);
    const d = await api<ProjectDetail>(`/api/projects/${id}`);
    setDetail(d);
  }, []);

  const refreshChat = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return setChat([]);
    const d = await api<{ messages: ChatMessage[] }>(`/api/projects/${id}/chat`);
    setChat(d.messages);
  }, []);

  const refreshActivities = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return setActivities([]);
    const d = await api<{ activities: ActivityItem[] }>(`/api/projects/${id}/activities?limit=30`);
    setActivities(d.activities);
  }, []);

  const refreshFiles = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return setFiles([]);
    const d = await api<{ files: FileItem[] }>(`/api/projects/${id}/files`);
    setFiles(d.files);
  }, []);

  const refreshProjectData = useCallback(async () => {
    await Promise.all([refreshDetail(), refreshTasks(), refreshChat(), refreshActivities(), refreshFiles()]);
  }, [refreshDetail, refreshTasks, refreshChat, refreshActivities, refreshFiles]);

  // 初始加载 + 轻量轮询（通知/统计/我的任务）
  useEffect(() => {
    if (!me) return;
    Promise.all([refreshTeams(), refreshProjects(), refreshOverview(), refreshNotifications(), refreshMyTasks()]).catch(() => {});
    const timer = setInterval(() => {
      refreshNotifications().catch(() => {});
      refreshOverview().catch(() => {});
      refreshMyTasks().catch(() => {});
      refreshDetail().catch(() => {}); // 成员在线状态等
    }, 20000);
    return () => clearInterval(timer);
  }, [me, refreshTeams, refreshProjects, refreshOverview, refreshNotifications, refreshMyTasks, refreshDetail]);

  // 切换项目时拉取项目数据
  useEffect(() => {
    if (!me || selectedId === null) {
      setDetail(null); setTasks([]); setChat([]); setActivities([]); setFiles([]);
      return;
    }
    refreshProjectData().catch(() => {});
  }, [me, selectedId, refreshProjectData]);

  // 聊天 / 日志轮询（8 秒，保证赞同、置顶与新消息同步）
  useEffect(() => {
    if (!me || selectedId === null) return;
    const timer = setInterval(() => {
      refreshChat().catch(() => {});
      refreshActivities().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [me, selectedId, refreshChat, refreshActivities]);

  /* ---------- 动作 ---------- */
  const selectProject = useCallback((id: number | null) => {
    setSelectedId(id);
    setDrawerTaskId(null);
    setTaskSearch("");
  }, []);

  const afterProjectMutation = useCallback(async () => {
    await Promise.all([refreshProjects(), refreshTeams(), refreshOverview()]);
  }, [refreshProjects, refreshTeams, refreshOverview]);

  const afterTaskMutation = useCallback(async () => {
    await Promise.all([refreshTasks(), refreshProjects(), refreshActivities(), refreshMyTasks(), refreshOverview()]);
  }, [refreshTasks, refreshProjects, refreshActivities, refreshMyTasks, refreshOverview]);

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
      await Promise.allSettled([
        refreshProjects(), refreshTeams(), refreshOverview(), refreshMyTasks(), refreshNotifications(),
      ]);
    },
    async createProject(teamId, name, key, description) {
      const d = await api<{ project: { id: number } }>("/api/projects", {
        method: "POST", json: { teamId, name, key, description: description ?? null },
      });
      await refreshProjects();
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
    async createSprint(input) {
      const id = selectedIdRef.current;
      if (!id) return;
      await api(`/api/projects/${id}/sprints`, { method: "POST", json: input });
      await Promise.all([refreshDetail(), refreshProjects()]);
    },
    async completeSprint(sprintId) {
      await api(`/api/sprints/${sprintId}`, { method: "PUT", json: { status: "completed" } });
      await Promise.all([refreshDetail(), refreshProjects()]);
    },
    async inviteMember(email) {
      const d = detail;
      if (!d) return;
      await api(`/api/teams/${d.team.id}/members`, { method: "POST", json: { email } });
      await Promise.all([refreshDetail(), refreshProjects()]);
    },
    async toggleStar(projectId) {
      await api(`/api/projects/${projectId}/star`, { method: "POST", json: {} });
      await Promise.all([refreshProjects(), refreshDetail()]);
    },
    async sendChat(content, opts) {
      const id = selectedIdRef.current;
      if (!id) return;
      await api(`/api/projects/${id}/chat`, {
        method: "POST",
        json: { content, replyToId: opts?.replyToId ?? null, taskId: opts?.taskId ?? null },
      });
      await refreshChat();
    },
    async toggleLike(messageId) {
      await api(`/api/chat/${messageId}/like`, { method: "POST", json: {} });
      await refreshChat();
    },
    async togglePin(messageId, pinned) {
      await api(`/api/chat/${messageId}/pin`, { method: "PUT", json: { pinned } });
      await refreshChat();
    },
    async uploadProjectFile(file) {
      const id = selectedIdRef.current;
      if (!id) throw new Error("请先选择项目");
      const d = await apiUpload<{ file: { originalName: string } }>(`/api/projects/${id}/files`, file);
      await refreshFiles();
      return d.file.originalName;
    },
    async uploadTaskFile(taskId, file) {
      const id = selectedIdRef.current;
      if (!id) throw new Error("请先选择项目");
      await apiUpload(`/api/projects/${id}/files`, file, taskId);
      await refreshFiles();
    },
    async markRead(ids) {
      await api("/api/notifications", { method: "PUT", json: ids?.length ? { ids } : { all: true } });
      await refreshNotifications();
    },
  }), [
    me, railView, focusSection, teams, projects, selectedId, detail, tasks, myTasks, chat,
    activities, files, notifications, unreadCount, overview, taskSearch, modal, drawerTaskId,
    selectProject, refreshProjects, refreshProjectData, refreshTasks, refreshChat,
    refreshActivities, refreshFiles, refreshNotifications, refreshMyTasks, refreshDetail, refreshTeams, refreshOverview,
    afterProjectMutation, afterTaskMutation,
  ]);

  /* ---------- 渲染 ---------- */
  if (authLoading || !me) return null;

  const project = projects.find((p) => p.id === selectedId);

  return (
    <WorkspaceContext.Provider value={store}>
      <div className="ws-app">
        <IconRail />
        {railView === "projects" && <ProjectSidebar />}

        <div className="ws-main">
          <TopBar />
          <div className="ws-body">
            <div className="ws-center" id="ws-center">
              {railView === "projects" && focusSection === "tasks" && <TaskPanel />}
              {railView === "projects" && focusSection === "chat" && <ChatPanel />}
              {railView === "projects" && focusSection === "space" && <SpacePanel />}
              {railView === "projectManagement" && <ManagementPanel kind="project" />}
              {railView === "teamManagement" && <ManagementPanel key="teams" kind="team" />}
              {railView === "todos" && <TodosView />}
              {railView === "notifications" && <NotificationsView />}
            </div>
            {railView === "projects" && <ProjectActivitySidebar />}
          </div>
          <div className="ws-statusbar">
            <span className="ws-dot" /> 已连接
            <span>· {project ? project.name : "未选择项目"}</span>
            <span>· {detail?.members.length ?? 0} 位成员</span>
            <span style={{ marginLeft: "auto" }}>AgileCampus 敏捷校园</span>
          </div>
        </div>
      </div>

      <TaskDrawer />

      {modal?.type === "newTeam" && <NewTeamModal onClose={() => setModal(null)} />}
      {modal?.type === "newProject" && <NewProjectModal onClose={() => setModal(null)} />}
      {modal?.type === "newTask" && (selectedId ? <NewTaskModal onClose={() => setModal(null)} /> : null)}
      {modal?.type === "newSprint" && (selectedId ? <NewSprintModal onClose={() => setModal(null)} /> : null)}
      {modal?.type === "invite" && (detail ? <InviteModal onClose={() => setModal(null)} /> : null)}
    </WorkspaceContext.Provider>
  );
}
