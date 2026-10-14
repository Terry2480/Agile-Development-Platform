import { sql } from "drizzle-orm";
import { db } from "@/db";

// 通知删除后仍保留去重记录；唯一约束跨进程、重启生效。
export async function generateDeadlineReminders(executor: Pick<typeof db, "execute"> = db) {
  return executor.execute(sql`
    WITH eligible AS (
      SELECT DISTINCT t.id AS task_id, recipient.user_id, t.due_on
      FROM tasks t JOIN projects p ON p.id = t.project_id
      JOIN LATERAL (
        SELECT c.user_id FROM task_collaborators c WHERE c.task_id = t.id
        UNION SELECT t.assignee_id WHERE t.assignee_id IS NOT NULL
      ) recipient ON true
      JOIN team_members m ON m.team_id = p.team_id AND m.user_id = recipient.user_id
      WHERE t.status <> 'done' AND p.status = 'active'
        AND t.due_on BETWEEN (now() AT TIME ZONE 'Asia/Hong_Kong')::date
        AND (now() AT TIME ZONE 'Asia/Hong_Kong')::date + 1
    ), claimed AS (
      INSERT INTO task_deadline_reminders(task_id, user_id, due_on)
      SELECT task_id, user_id, due_on FROM eligible
      ON CONFLICT DO NOTHING RETURNING task_id, user_id, due_on
    )
    INSERT INTO notifications(user_id, type, title, entity_type, entity_id)
    SELECT c.user_id, 'deadline',
      '任务 ' || p.key || '-' || lpad(t.number::text, greatest(3, length(t.number::text)), '0') || '「' || t.title || '」'
      || CASE WHEN c.due_on = (now() AT TIME ZONE 'Asia/Hong_Kong')::date
        THEN '今天截止，请及时处理' ELSE '明天截止，请及时处理' END,
      'task', c.task_id
    FROM claimed c JOIN tasks t ON t.id = c.task_id JOIN projects p ON p.id = t.project_id
    RETURNING id
  `);
}

export async function tryDeadlineReminders() {
  const state = globalThis as typeof globalThis & { deadlineReminderRun?: Promise<void>; deadlineReminderNext?: number };
  if (state.deadlineReminderRun) return state.deadlineReminderRun;
  if (Date.now() < (state.deadlineReminderNext ?? 0)) return;
  state.deadlineReminderNext = Date.now() + 60000;
  state.deadlineReminderRun = (async () => {
    try { await generateDeadlineReminders(); }
    catch { console.error("[deadline-reminders] 截止提醒生成失败，将在下次重试，请检查数据库迁移"); }
  })();
  try { await state.deadlineReminderRun; } finally { state.deadlineReminderRun = undefined; }
}
