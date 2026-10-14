export type ChecklistItem = { id: number; taskId: number; title: string; completed: boolean };
export type ChecklistChange = { taskId: number } & (
  { type: "upsert"; item: ChecklistItem } | { type: "delete"; itemId: number }
);
export const CHECKLIST_CHANGED = "agilecampus-checklist-changed";

export function applyChecklistChange(items: ChecklistItem[], change: ChecklistChange): ChecklistItem[] {
  if (change.type === "delete") return items.filter((item) => item.id !== change.itemId);
  return [...items.filter((item) => item.id !== change.item.id), change.item].sort((a, b) => a.id - b.id);
}
