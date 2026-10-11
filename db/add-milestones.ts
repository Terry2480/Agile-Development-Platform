import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS milestones (id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name text NOT NULL, due_on date NOT NULL, requirements text NOT NULL DEFAULT '', completed boolean NOT NULL DEFAULT false)`;
      await tx`CREATE TABLE IF NOT EXISTS milestone_tasks (milestone_id integer NOT NULL REFERENCES milestones(id) ON DELETE CASCADE, task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, CONSTRAINT milestone_tasks_uq UNIQUE(milestone_id, task_id))`;
    });
    console.log("课程里程碑数据表已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("里程碑数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
