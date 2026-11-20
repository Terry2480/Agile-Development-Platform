import { api, ApiError, type NotificationItem } from "./api-client";

type Target =
  | { projectId: number; section: "tasks" | "chat"; taskId?: number }
  | { section: "dm"; dmConversationId: number }
  | { section: "docs"; docId: number };
type FetchTarget = <T>(path: string, options?: { signal?: AbortSignal }) => Promise<T>;

export async function resolveNotificationTarget(notification: NotificationItem, signal?: AbortSignal,
  fetchTarget: FetchTarget = api): Promise<Target | null> {
  const id = notification.entityId;
  if (!id || !Number.isSafeInteger(id) || id <= 0) return null;
  try {
    // 私信通知：entityId 即会话 id，仅会话双方会收到，无需再请求校验
    if (notification.entityType === "dm") {
      return { section: "dm", dmConversationId: id };
    }
    // 文档评论/@提及：entityId 即文档 id，请求详情顺带校验访问权限
    if (notification.entityType === "doc") {
      const { doc } = await fetchTarget<{ doc: { id: number } }>(`/api/docs/${id}`, { signal });
      return { section: "docs", docId: doc.id };
    }
    if (notification.entityType === "task") {
      const { task } = await fetchTarget<{ task: { id: number; projectId: number } }>(`/api/tasks/${id}`, { signal });
      return { projectId: task.projectId, section: "tasks", taskId: task.id };
    }
    if (notification.entityType === "project") {
      const { project } = await fetchTarget<{ project: { id: number } }>(`/api/projects/${id}`, { signal });
      return { projectId: project.id, section: "chat" };
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      throw new Error("相关任务或项目已删除，或你已没有访问权限。");
    }
    throw error;
  }
}
