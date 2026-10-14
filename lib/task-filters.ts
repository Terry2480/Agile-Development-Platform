import type { TaskItem } from "./api-client";

export type TaskFilters = {
  relation: "all" | "mine" | "assigned" | "collaborating";
  due: "all" | "today" | "tomorrow" | "overdue" | "none";
  activeSprint: boolean; status: string; priority: string; assignee: string; label: string; project: string;
};
export const EMPTY_TASK_FILTERS: TaskFilters = { relation: "all", due: "all", activeSprint: false, status: "", priority: "", assignee: "", label: "", project: "" };
export function filterTasks(tasks: TaskItem[], filters: TaskFilters, userId: number, search: string,
  activeSprintIds: number[], now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const query = search.trim().toLowerCase();
  return tasks.filter((task) => {
    const assigned = task.assigneeId === userId;
    const collaborating = !assigned && task.collaborators?.some((member) => member.id === userId);
    if (filters.relation === "mine" && !assigned && !collaborating) return false;
    if (filters.relation === "assigned" && !assigned) return false;
    if (filters.relation === "collaborating" && !collaborating) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.assignee === "unassigned" ? task.assigneeId !== null : filters.assignee && String(task.assigneeId) !== filters.assignee) return false;
    if (filters.label && !task.labels.some((label) => String(label.id) === filters.label)) return false;
    if (filters.project && String(task.projectId) !== filters.project) return false;
    if (filters.activeSprint && (task.sprintId === null || !activeSprintIds.includes(task.sprintId))) return false;
    if (filters.due === "none" && task.dueOn !== null) return false;
    if (filters.due !== "all" && filters.due !== "none") {
      if (task.status === "done" || !task.dueOn) return false;
      if (filters.due === "today" && task.dueOn !== today) return false;
      if (filters.due === "tomorrow" && task.dueOn !== tomorrowKey) return false;
      if (filters.due === "overdue" && task.dueOn >= today) return false;
    }
    return !query || [task.title, task.code, task.projectName ?? ""].some((value) => value.toLowerCase().includes(query));
  });
}
