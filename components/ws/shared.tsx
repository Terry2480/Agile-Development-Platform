"use client";

// 工作空间共享模块：Context 类型、内联 SVG 图标、头像、通用弹窗
import { createContext, useContext } from "react";
import type {
  Me, Team, ProjectSummary, ProjectDetail, TaskItem, ChatMessage,
  ActivityItem, FileItem, NotificationItem, Overview,
} from "@/lib/api-client";

/* ---------- 图标（feather 风格线条图标，stroke 继承 currentColor） ---------- */
const ICON_PATHS: Record<string, string> = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  bell: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48",
  at: "M12 16v-4a2 2 0 10-4 0v4a4 4 0 108 0V8a6 6 0 016 6v1a4 4 0 01-4 4h-1M4 12a8 8 0 1016 0 8 8 0 00-16 0z",
  smile: "M12 21a9 9 0 100-18 9 9 0 000 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  x: "M18 6L6 18M6 6l12 12",
  pin: "M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 002-2v-.58a.42.42 0 00-.42-.42H6.42a.42.42 0 00-.42.42V4a2 2 0 002 2 1 1 0 011 1z",
  message: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  file: "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
  trash: "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z",
  users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICON_PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {(ICON_PATHS[name] ?? "").split("M").filter(Boolean).map((d, i) => (
        <path key={i} d={"M" + d} />
      ))}
    </svg>
  );
}

/* ---------- 头像 ---------- */
export function Avatar({ name, colorKey, size = "", title }: { name: string; colorKey: number | string; size?: "" | "sm" | "lg"; title?: string }) {
  const color = avatarColorOf(colorKey);
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className={`ws-avatar ${size}`} style={{ background: color }} title={title ?? name}>{letter}</span>
  );
}

import { avatarColor } from "@/lib/api-client";
function avatarColorOf(key: number | string) {
  return avatarColor(key);
}

/* ---------- 通用弹窗 ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ws-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ws-modal">
        <h3>
          {title}
          <button className="ws-icon-btn" onClick={onClose}><Icon name="x" size={18} /></button>
        </h3>
        {children}
      </div>
    </div>
  );
}

/* ---------- 工作空间状态（page.tsx 提供实现） ---------- */
export type RailView = "projects" | "todos" | "notifications";
export type FocusSection = "tasks" | "chat" | "space" | "team";
export type ModalState =
  | { type: "newTeam" }
  | { type: "newProject" }
  | { type: "newTask" }
  | { type: "newSprint" }
  | { type: "invite" }
  | null;

export interface WorkspaceStore {
  me: Me;
  railView: RailView;
  setRailView(v: RailView): void;
  focusSection: FocusSection;
  setFocusSection(s: FocusSection): void;
  teams: Team[];
  projects: ProjectSummary[];
  selectedId: number | null;
  detail: ProjectDetail | null;
  tasks: TaskItem[];
  myTasks: TaskItem[];
  chat: ChatMessage[];
  activities: ActivityItem[];
  files: FileItem[];
  notifications: NotificationItem[];
  unreadCount: number;
  overview: Overview | null;
  taskSearch: string;
  setTaskSearch(q: string): void;
  selectProject(id: number | null): void;
  modal: ModalState;
  openModal(m: ModalState): void;
  closeModal(): void;
  drawerTaskId: number | null;
  openTask(id: number): void;
  closeTask(): void;
  refreshProjects(): Promise<void>;
  refreshProjectData(): Promise<void>;
  refreshTasks(): Promise<void>;
  refreshChat(): Promise<void>;
  refreshActivities(): Promise<void>;
  refreshFiles(): Promise<void>;
  refreshNotifications(): Promise<void>;
  refreshMyTasks(): Promise<void>;
  createTeam(name: string, description?: string): Promise<void>;
  createProject(teamId: number, name: string, key: string, description?: string): Promise<void>;
  createTask(input: Record<string, unknown>): Promise<void>;
  updateTask(id: number, patch: Record<string, unknown>): Promise<void>;
  createSprint(input: Record<string, unknown>): Promise<void>;
  completeSprint(id: number): Promise<void>;
  inviteMember(email: string): Promise<void>;
  toggleStar(projectId: number): Promise<void>;
  sendChat(content: string, opts?: { replyToId?: number; taskId?: number }): Promise<void>;
  toggleLike(messageId: number): Promise<void>;
  togglePin(messageId: number, pinned: boolean): Promise<void>;
  uploadProjectFile(file: File): Promise<string>;
  uploadTaskFile(taskId: number, file: File): Promise<void>;
  markRead(ids?: number[]): Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function useWorkspace(): WorkspaceStore {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  return store;
}
