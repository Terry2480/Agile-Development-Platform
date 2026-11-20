import type { ProjectDetail } from "./api-client";
import { canManageDuties } from "./team-duties";

export function canCreateSprint(detail: ProjectDetail | null, projectId: number | null, userId: number) {
  if (!detail || detail.project.id !== projectId) return false;
  const member = detail.members.find((m) => m.userId === userId);
  return member ? canManageDuties(member) : false;
}
