import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS duty text`;
      await tx`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS duties text[]`;
      await tx`UPDATE team_members SET duties = CASE
        WHEN duty IS NULL THEN ARRAY[]::text[] ELSE ARRAY[duty] END
        WHERE duties IS NULL`;
    });
    console.log("成员多标签字段已就绪，已有分工已保留");
  } finally { await client.end(); }
}
main().catch(() => { console.error("成员多标签更新失败，请检查数据库连接"); process.exitCode = 1; });
