// 前端统一请求封装 + 业务类型定义（与后端 docs/API.md 一一对应）
// 用法：api<T>(path, { json: {...} }) 自动带 JSON 头；失败抛 Error(中文提示)
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE } from "./upload-limits";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error("无法连接服务器，请检查网络后重试");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = res.status === 401 ? "登录已过期，请重新登录" : res.status === 403 ? "你没有执行此操作的权限" : res.status >= 500 ? "服务器暂时无法处理请求，请稍后重试" : "请求失败，请重试";
    throw new ApiError(res.status, data?.error ?? fallback);
  }
  if (data === null) throw new Error("服务器返回的数据异常，请重试");
  return data as T;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  return requestJson<T>(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

export async function uploadFile<T>(path: string, file: File, taskId?: number): Promise<T> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(UPLOAD_LIMIT_MESSAGE);
  if (file.size === 0) throw new Error("文件为空");
  const form = new FormData();
  form.append("file", file);
  if (taskId) form.append("taskId", String(taskId));
  return requestJson<T>(path, { method: "POST", body: form });
}

/* ---------- 类型 ---------- */

export type Me = {
  id: number;
  email: string;
  name: string | null;
  studentId: string;
  gender: string | null;
  region: string | null;
  bio: string | null;
  role: string;
};

export type Team = {
  id: number;
  name: string;
  description: string | null;
  role: string;
  memberCount: number;
  projectCount: number;
};

export type TaskCounts = { total: number; todo: number; doing: number; done: number };

export type SprintBrief = { id: number; name: string; endsOn: string | null; goal: string | null } | null;

export type ProjectSummary = {
  id: number;
  teamId: number;
  teamName: string;
  name: string;
  key: string;
  description: string | null;
  status: string;
  starred: boolean;
  taskCounts: TaskCounts;
  activeSprint: SprintBrief;
  members: { userId: number; name: string }[];
};

export type Sprint = {
  id: number;
  projectId: number;
  name: string;
  goal: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: "planned" | "active" | "completed";
  createdAt: string;
};

export type Label = { id: number; name: string; color: string };

export type ProjectMember = {
  duty: string | null;
  userId: number;
  name: string | null;
  studentId: string;
  email: string;
  role: string;
  displayName: string;
  online: boolean; // 5 分钟内有活跃会话
};

export type ProjectDetail = {
  project: { id: number; teamId: number; name: string; key: string; description: string | null; status: string };
  team: { id: number; name: string; description: string | null };
  myRole: string;
  members: ProjectMember[];
  sprints: Sprint[];
  labels: Label[];
  taskCounts: TaskCounts;
  starred: boolean;
};

export type TaskAssignee = { id: number | null; name: string | null; studentId: string | null; displayName: string } | null;

export type TaskItem = {
  id: number;
  projectId: number;
  projectName?: string;
  sprintId: number | null;
  number: number;
  code: string;
  title: string;
  description: string | null;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  assigneeId: number | null;
  assignee: TaskAssignee;
  dueOn: string | null;
  labels: Label[];
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskComment = {
  id: number;
  content: string;
  createdAt: string;
  authorId: number;
  authorDisplayName: string;
};

export type ChatMessage = {
  id: number;
  content: string;
  pinned: boolean;
  taskId: number | null;
  replyToId: number | null;
  createdAt: string;
  author: { id: number; displayName: string };
  likeCount: number;
  likedByMe: boolean;
  replyTo: { id: number; content: string; authorName: string } | null;
  task: { id: number; code: string; title: string; status: string } | null;
};

export type ActivityItem = {
  id: number;
  action: string;
  detail: string;
  taskId: number | null;
  createdAt: string;
  actorName: string | null;
  actorStudentId: string;
};

export type FileItem = {
  id: number;
  uploaderId: number;
  taskId: number | null;
  originalName: string;
  mimeType: string | null;
  size: number;
  createdAt: string;
  uploaderName: string | null;
  uploaderStudentId: string;
};

export type NotificationItem = {
  id: number;
  type: "assigned" | "mention" | "comment";
  title: string;
  entityType: string | null;
  entityId: number | null;
  read: boolean;
  createdAt: string;
};

export type Overview = {
  teamCount: number;
  projectCount: number;
  taskTotal: number;
  taskDone: number;
  myTodo: number;
  myDoing: number;
};

/* ---------- 展示工具 ---------- */

export const STATUS_TEXT: Record<string, string> = { todo: "待开始", doing: "进行中", done: "已完成" };
export const PRIORITY_TEXT: Record<string, string> = { high: "高", medium: "中", low: "低" };

// 头像底色：全员统一品牌蓝，同一深浅（用户要求每个人的头像底色一致，靠首字母区分人）
export function avatarColor(_key?: number | string): string {
  return "#3b6ef5";
}

export function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

// 截止日展示：今天 / 明天 / 后天 / M月D日；逾期标红
export function dueInfo(dueOn: string): { text: string; overdue: boolean; soon: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueOn + "T00:00:00");
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: `逾期 ${-diff} 天`, overdue: true, soon: false };
  if (diff === 0) return { text: "今天截止", overdue: false, soon: true };
  if (diff === 1) return { text: "明天截止", overdue: false, soon: true };
  if (diff === 2) return { text: "后天截止", overdue: false, soon: false };
  return { text: `${due.getMonth() + 1}月${due.getDate()}日截止`, overdue: false, soon: false };
}

// Sprint 剩余天数
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
}
