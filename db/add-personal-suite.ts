import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client`CREATE TABLE IF NOT EXISTS personal_todos (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL,
      note text,
      done boolean NOT NULL DEFAULT false,
      due_on date,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await client`CREATE INDEX IF NOT EXISTS personal_todos_user_idx ON personal_todos (user_id)`;
    await client`CREATE TABLE IF NOT EXISTS personal_notes (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT '',
      content text NOT NULL DEFAULT '',
      color text NOT NULL DEFAULT 'yellow',
      pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await client`CREATE INDEX IF NOT EXISTS personal_notes_user_idx ON personal_notes (user_id)`;
    console.log("个人效率中心数据表（待办/记事）已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("个人效率中心数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
