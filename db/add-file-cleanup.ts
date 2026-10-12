import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS file_cleanup (stored_name text PRIMARY KEY, not_before timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, last_error text)`;
      await tx`CREATE OR REPLACE FUNCTION queue_deleted_attachment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO file_cleanup(stored_name) VALUES (OLD.stored_name) ON CONFLICT (stored_name) DO UPDATE SET not_before = LEAST(file_cleanup.not_before, now()); RETURN OLD; END $$`;
      await tx`CREATE OR REPLACE TRIGGER attachments_file_cleanup AFTER DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION queue_deleted_attachment()`;
    }); console.log("附件清理队列及删除触发器已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("附件清理更新失败，请检查数据库连接"); process.exitCode = 1; });
