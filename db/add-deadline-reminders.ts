import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client`CREATE TABLE IF NOT EXISTS task_deadline_reminders (
      task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      due_on date NOT NULL,
      CONSTRAINT task_deadline_reminders_task_user_due_uq UNIQUE(task_id,user_id,due_on)
    )`;
    console.log("截止提醒去重表已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("截止提醒更新失败，请检查数据库连接"); process.exitCode = 1; });
