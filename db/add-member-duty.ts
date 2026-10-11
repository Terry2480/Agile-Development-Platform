import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS duty text`;
    console.log("成员分工字段已就绪");
  } finally {
    await client.end();
  }
}

main().catch(() => { console.error("成员分工字段更新失败，请检查数据库连接"); process.exitCode = 1; });
