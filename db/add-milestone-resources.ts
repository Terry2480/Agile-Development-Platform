import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client`CREATE TABLE IF NOT EXISTS milestone_resources (
      id serial PRIMARY KEY, milestone_id integer NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
      attachment_id integer REFERENCES attachments(id) ON DELETE CASCADE,
      title text NOT NULL, url text, created_by_id integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT milestone_resources_file_uq UNIQUE(milestone_id,attachment_id),
      CONSTRAINT milestone_resources_url_uq UNIQUE(milestone_id,url),
      CONSTRAINT milestone_resources_kind_check CHECK ((attachment_id IS NOT NULL AND url IS NULL) OR (attachment_id IS NULL AND url IS NOT NULL))
    )`;
    console.log("里程碑成果区已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("成果区更新失败，请检查数据库连接"); process.exitCode = 1; });
