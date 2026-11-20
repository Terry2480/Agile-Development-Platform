import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`CREATE TABLE IF NOT EXISTS dm_conversations (
        id serial PRIMARY KEY,
        user_a_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hidden_for_a boolean NOT NULL DEFAULT false,
        hidden_for_b boolean NOT NULL DEFAULT false,
        last_message_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT dm_conversations_pair_uq UNIQUE (user_a_id, user_b_id),
        CONSTRAINT dm_conversations_pair_check CHECK (user_a_id < user_b_id)
      )`;
      await tx`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS hidden_for_a boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS hidden_for_b boolean NOT NULL DEFAULT false`;
      await tx`CREATE TABLE IF NOT EXISTS dm_messages (
        id serial PRIMARY KEY,
        conversation_id integer NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        sender_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content text NOT NULL,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await tx`CREATE INDEX IF NOT EXISTS dm_messages_conversation_idx ON dm_messages (conversation_id)`;
      await tx`CREATE TABLE IF NOT EXISTS dm_attachments (
        id serial PRIMARY KEY,
        conversation_id integer NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        uploader_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_name text NOT NULL,
        stored_name text NOT NULL,
        mime_type text,
        size integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await tx`CREATE INDEX IF NOT EXISTS dm_attachments_conversation_idx ON dm_attachments (conversation_id)`;
      await tx`ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS attachment_id integer REFERENCES dm_attachments(id) ON DELETE SET NULL`;
      // 模块三（v6.2）：私聊个人设置（置顶/免打扰）
      await tx`CREATE TABLE IF NOT EXISTS dm_settings (
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id integer NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        pinned boolean NOT NULL DEFAULT false,
        muted boolean NOT NULL DEFAULT false,
        PRIMARY KEY (user_id, conversation_id)
      )`;
    });
    console.log("私聊数据表已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("私聊数据表更新失败，请检查数据库连接"); process.exitCode = 1; });
