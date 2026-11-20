import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS team_invites (team_id integer PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE, code text NOT NULL UNIQUE, expires_at timestamp NOT NULL)`;
      await tx`CREATE TABLE IF NOT EXISTS team_join_requests (id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending', created_at timestamp NOT NULL DEFAULT now(), CONSTRAINT team_join_requests_team_user_uq UNIQUE(team_id, user_id))`;
    }); console.log("团队邀请码数据表已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("邀请码数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
