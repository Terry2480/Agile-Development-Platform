import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    if (process.argv.includes("--check")) {
      console.log(await sql`SELECT current_setting('TimeZone') AS database_timezone, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'chat_messages' AND column_name = 'created_at'`);
      console.log(await sql`SELECT id, created_at::text AS stored_time FROM chat_messages ORDER BY id DESC LIMIT 3`);
      return;
    }
    await sql.begin(async (tx) => {
      await tx`LOCK TABLE chat_messages IN ACCESS EXCLUSIVE MODE`;
      const [column] = await tx`SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'chat_messages' AND column_name = 'created_at'`;
      if (!column) throw new Error("聊天时间字段不存在");
      if (column.data_type === "timestamp with time zone") { console.log("聊天时间已包含时区，无需重复转换"); return; }
      const legacyZone = process.env.LEGACY_CHAT_TIMEZONE;
      if (!legacyZone) throw new Error("请先检查旧消息的原始时间，再设置 LEGACY_CHAT_TIMEZONE（例如 Asia/Shanghai 或 UTC）；不能猜测历史时区");
      const valid = await tx`SELECT name FROM pg_timezone_names WHERE name = ${legacyZone}`;
      if (!valid.length) throw new Error("LEGACY_CHAT_TIMEZONE 不是有效时区");
      await tx`ALTER TABLE chat_messages ALTER COLUMN created_at DROP DEFAULT`;
      // PostgreSQL DDL does not support a bound parameter here; quote the validated timezone as a SQL literal.
      const zoneLiteral = legacyZone.replaceAll("'", "''");
      await tx.unsafe(`ALTER TABLE chat_messages ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE '${zoneLiteral}'`);
      await tx`ALTER TABLE chat_messages ALTER COLUMN created_at SET DEFAULT now()`;
      console.log("聊天时间已转换为带时区时间，历史消息按指定时区保留实际时刻");
    });
  } finally { await sql.end(); }
}
main().catch((e: Error) => { console.error(e.message); process.exitCode = 1; });
