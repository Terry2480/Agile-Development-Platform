"use client";

export function CollaboratorPicker({ members, selected, assigneeId, disabled, onChange }: {
  members: { userId: number; displayName: string }[]; selected: number[];
  assigneeId: number | null; disabled?: boolean; onChange(ids: number[]): void;
}) {
  const ids = [...new Set([...selected, ...(assigneeId ? [assigneeId] : [])])];
  return <div className="ws-field">
    <label>协作成员（可多选）</label>
    <div className="ws-duty-choices" role="group" aria-label="任务协作成员">
      {members.map((member) => <label key={member.userId} className={`ws-duty-choice ${ids.includes(member.userId) ? "selected" : ""}`}>
        <input type="checkbox" checked={ids.includes(member.userId)} disabled={disabled || member.userId === assigneeId}
          onChange={(e) => onChange(e.target.checked ? [...ids, member.userId] : ids.filter((id) => id !== member.userId))} />
        {member.displayName}{member.userId === assigneeId ? "（负责人）" : ""}
      </label>)}
    </div>
    <p className="ws-team-note">负责人自动参与，所有协作成员都会收到待办提醒。</p>
  </div>;
}
