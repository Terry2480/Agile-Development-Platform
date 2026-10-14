"use client";
import { Avatar } from "./shared";

type Person = { id: number; displayName: string };
export function TaskParticipants({ assignee, collaborators, showNames = false }: { assignee: Person | null; collaborators: Person[]; showNames?: boolean }) {
  const others = [...new Map(collaborators.filter((person) => person.id !== assignee?.id).map((person) => [person.id, person])).values()];
  const total = others.length + (assignee ? 1 : 0);
  return <span className="ws-task-participants">
    <span className="ws-task-owner" title={assignee ? `负责人：${assignee.displayName}` : "尚未分配负责人"}>
      {assignee && <Avatar name={assignee.displayName} colorKey={assignee.id} size="sm" />}
      <span className="ws-task-owner-label">负责人</span><b>{assignee?.displayName || "未分配"}</b>
    </span>
    {showNames && others.length > 0 ? <span className="ws-task-collaborator-names">{others.map((person) => <span key={person.id} title={`协作成员：${person.displayName}`}><Avatar name={person.displayName} colorKey={person.id} size="sm" />{person.displayName}</span>)}</span> : others.length > 0 && <span className="ws-task-collaborator-avatars" aria-label={`协作成员：${others.map((person) => person.displayName).join("、")}`}>
      {others.slice(0, 3).map((person) => <Avatar key={person.id} name={person.displayName} colorKey={person.id} size="sm" title={`协作成员：${person.displayName}`} />)}
      {others.length > 3 && <span className="ws-task-more-members" title={others.slice(3).map((person) => person.displayName).join("、")}>+{others.length - 3}</span>}
    </span>}
    {total > 0 && <span className="ws-task-participant-count">{total} 人参与</span>}
  </span>;
}
