import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS task_collaborators (
        task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT task_collaborators_task_user_uq UNIQUE(task_id,user_id)
      )`;
      await tx`INSERT INTO task_collaborators(task_id,user_id)
        SELECT t.id,t.assignee_id FROM tasks t JOIN projects p ON p.id=t.project_id
        JOIN team_members m ON m.team_id=p.team_id AND m.user_id=t.assignee_id
        ON CONFLICT DO NOTHING`;
    });
    console.log("任务协作成员已就绪，原负责人已保留");
  } finally { await client.end(); }
}
main().catch(() => { console.error("协作成员更新失败，请检查数据库连接"); process.exitCode = 1; });
