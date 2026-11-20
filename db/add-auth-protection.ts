import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { await client`CREATE TABLE IF NOT EXISTS auth_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)`; console.log("登录限流数据表已就绪"); }
  finally { await client.end(); }
}
main().catch(() => { console.error("登录限流数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
