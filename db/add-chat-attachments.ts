import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
async function main() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await client.begin(async (tx) => {
      // 聊天文件消息：文件本体即项目文件（attachments），撤回文件后消息保留（SET NULL 降级）
      await tx`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_id integer REFERENCES attachments(id) ON DELETE SET NULL`;
    });
    console.log("聊天文件消息字段已就绪");
  } finally { await client.end(); }
}
main().catch(() => { console.error("聊天文件消息字段更新失败，请检查数据库连接"); process.exitCode = 1; });
