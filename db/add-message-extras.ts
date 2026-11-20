import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      // 消息体验增强：表情回应（扩展唯一键）、频道/私信消息撤回、私信引用回复
      await tx`ALTER TABLE chat_likes ADD COLUMN IF NOT EXISTS emoji text NOT NULL DEFAULT '👍'`;
      await tx`ALTER TABLE chat_likes DROP CONSTRAINT IF EXISTS chat_likes_message_user_uq`;
      await tx`ALTER TABLE chat_likes DROP CONSTRAINT IF EXISTS chat_likes_message_user_emoji_uq`;
      await tx`ALTER TABLE chat_likes ADD CONSTRAINT chat_likes_message_user_emoji_uq UNIQUE (message_id, user_id, emoji)`;
      await tx`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS recalled boolean NOT NULL DEFAULT false`;
      await tx`ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_id integer REFERENCES dm_messages(id) ON DELETE CASCADE`;
      await tx`ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS recalled boolean NOT NULL DEFAULT false`;
    });
    console.log("消息体验增强字段已就绪（表情回应/撤回/私信引用回复）");
  } finally { await client.end(); }
}
main().catch(() => { console.error("消息体验增强字段更新失败，请检查数据库连接"); process.exitCode = 1; });
