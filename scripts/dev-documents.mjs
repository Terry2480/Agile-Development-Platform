import {fileURLToPath} from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";

config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw Error("请先配置 .env.local 中的 DATABASE_URL");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("审查版只允许本机测试库");
// Never use the ordinary database, even if DATABASE_URL points to it.
url.pathname = "/agilecampus_test_documents_api_20261112";
const client = postgres(url.toString(), { max: 1, connect_timeout: 3 });
const email = "document-review@example.test";
const initialPassword = "DocReview2026!";
try {
  const [ready] = await client`SELECT to_regclass('public.document_migrations') IS NOT NULL AS ready`;
  if (!ready.ready || !(await client`SELECT key FROM document_migrations WHERE key='documents-schema-v1'`).length)
    throw Error("审查测试库尚未准备好，请先完成隔离库迁移演练；此命令不会升级现用库");
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(177002,3112)`;
    let [user] = await tx`SELECT id FROM users WHERE email=${email}`;
    if (!user) {
      const salt = randomBytes(16).toString("hex");
      const hash = `${salt}:${scryptSync(initialPassword, salt, 64).toString("hex")}`;
      [user] = await tx`INSERT INTO users(email,student_id,password_hash,name) VALUES(${email},'document-review-20261112',${hash},'文档审查员') RETURNING id`;
    }
    let [team] = await tx`SELECT id FROM teams WHERE owner_id=${user.id} AND name='文档系统审查团队' ORDER BY id LIMIT 1`;
    if (!team) [team] = await tx`INSERT INTO teams(name,owner_id) VALUES('文档系统审查团队',${user.id}) RETURNING id`;
    await tx`INSERT INTO team_members(team_id,user_id,role) VALUES(${team.id},${user.id},'owner') ON CONFLICT(team_id,user_id) DO NOTHING`;
    if (!(await tx`SELECT id FROM projects WHERE team_id=${team.id} AND key='DOCREVIEW'`).length)
      await tx`INSERT INTO projects(team_id,name,key) VALUES(${team.id},'文档系统审查项目','DOCREVIEW')`;
  });
} finally { await client.end(); }

console.log("审查库：agilecampus_test_documents_api_20261112（不修改 .env.local）");
console.log(`测试账号：${email}  初始密码：${initialPassword}`);
if (!process.argv.includes("--prepare-only")) {
  console.log("打开：http://127.0.0.1:3112  登录后点击顶部“项目文档”。Ctrl+C 停止。");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3112"], {
    stdio: "inherit", windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DOCUMENT_UI_REHEARSAL: "1",
      UPLOAD_DIR: fileURLToPath(new URL("../uploads-document-review/",import.meta.url)),
      // Next may normalize the internal request URL to localhost even when the
      // browser opens 127.0.0.1. Trust only these exact local rehearsal origins.
      AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:3112,http://localhost:3112",
    },
  });
  child.on("error", e => { console.error("启动失败：", e.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 0; });
}
