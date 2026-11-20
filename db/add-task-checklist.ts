import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS task_checklist_items (
        id serial PRIMARY KEY, task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title text NOT NULL, completed boolean NOT NULL DEFAULT false
      )`;
      await tx`CREATE INDEX IF NOT EXISTS task_checklist_task_idx ON task_checklist_items(task_id)`;
    });
    console.log("任务检查清单已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("检查清单更新失败，请检查数据库连接"); process.exitCode = 1; });
