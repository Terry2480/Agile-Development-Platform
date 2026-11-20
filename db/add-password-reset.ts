import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id serial PRIMARY KEY,
      email text NOT NULL,
      code_hash text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz DEFAULT now()
    )`;
    await client`CREATE INDEX IF NOT EXISTS password_reset_tokens_email_idx ON password_reset_tokens (email)`;
    console.log("密码找回验证码表已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("密码找回数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
