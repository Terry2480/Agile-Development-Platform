import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, like } from "drizzle-orm";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, process, Response, Request, URL, File, Buffer, console: { error() {} }, require: (name) => overrides[name] ?? require(name) });
  return exports;
}
const schema = load("../db/schema.ts");
const { users, teams, projects, teamMembers, attachments, fileCleanup } = schema;

test("deletion queue follows cascade and rollback; cleanup retries failures and protects live files", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const rollback = new Error("rollback fixtures");
  try {
    await assert.rejects(drizzle(client).transaction(async (outer) => {
      const prefix = randomUUID();
      const [user] = await outer.insert(users).values({ email: `${prefix}@example.test`, studentId: prefix, passwordHash: "test-only" }).returning();
      const [team] = await outer.insert(teams).values({ name: "附件一致性测试", ownerId: user.id }).returning();
      const [project] = await outer.insert(projects).values({ teamId: team.id, key: "TT", name: "测试" }).returning();
      const liveName = prefix + ".live";
      await outer.insert(attachments).values({ projectId: project.id, uploaderId: user.id, originalName: "live", storedName: liveName });
      const removed = new Error("rollback deletion");
      await assert.rejects(outer.transaction(async (tx) => { await tx.delete(projects).where(eq(projects.id, project.id)); throw removed; }), (e) => e === removed);
      assert.equal((await outer.select().from(fileCleanup).where(eq(fileCleanup.storedName, liveName))).length, 0);
      await outer.delete(projects).where(eq(projects.id, project.id));
      assert.equal((await outer.select().from(fileCleanup).where(eq(fileCleanup.storedName, liveName))).length, 1);
      const db = (base) => new Proxy(base, { get(target, prop) {
        if (prop === "transaction") return (callback) => target.transaction((tx) => callback(db(tx)));
        if (prop === "select") return (...args) => { const query = target.select(...args); const from = query.from.bind(query); query.from = (table) => { const builder = from(table); if (table === fileCleanup) { const where = builder.where.bind(builder); builder.where = (condition) => where(and(condition, like(fileCleanup.storedName, prefix + "%"))); } return builder; }; return query; };
        const value = target[prop]; return typeof value === "function" ? value.bind(target) : value;
      } });
      let fail = true; let attempts = 0;
      const cleanup = load("../lib/file-cleanup.ts", { "@/db": { db: db(outer) }, "@/db/schema": schema, "node:fs/promises": { unlink: async () => { attempts++; if (fail) throw Object.assign(new Error("denied"), { code: "EACCES" }); throw Object.assign(new Error("missing"), { code: "ENOENT" }); } } });
      await cleanup.drainFileCleanup(1);
      const [job] = await outer.select().from(fileCleanup).where(eq(fileCleanup.storedName, liveName));
      assert.equal(job.attempts, 1); assert.equal(job.lastError, "EACCES");
      fail = false;
      await outer.update(fileCleanup).set({ notBefore: new Date(0) }).where(eq(fileCleanup.storedName, liveName));
      await cleanup.drainFileCleanup(1);
      assert.equal((await outer.select().from(fileCleanup).where(eq(fileCleanup.storedName, liveName))).length, 0);
      const [newProject] = await outer.insert(projects).values({ teamId: team.id, key: "YY", name: "保留" }).returning();
      await outer.insert(attachments).values({ projectId: newProject.id, uploaderId: user.id, originalName: "keep", storedName: liveName });
      await outer.insert(fileCleanup).values({ storedName: liveName });
      const before = attempts; await cleanup.drainFileCleanup(1); assert.equal(attempts, before);
      for (const name of ["../bad", "..", "C:\\bad", "x/y"]) assert.throws(() => cleanup.uploadPath(name));
      throw rollback;
    }), (e) => e === rollback);
  } finally { await client.end(); }
});

test("upload log failure rolls back attachment metadata and cleans the written file", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const rollback = new Error("rollback fixtures");
  try {
    await assert.rejects(drizzle(client).transaction(async (db) => {
      const id = randomUUID();
      const [user] = await db.insert(users).values({ email: `${id}@example.test`, studentId: id, passwordHash: "test-only" }).returning();
      const [team] = await db.insert(teams).values({ name: "上传测试", ownerId: user.id }).returning();
      await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "owner" });
      const [project] = await db.insert(projects).values({ teamId: team.id, key: "UP", name: "上传" }).returning();
      const files = new Set();
      const common = { "@/db": { db }, "@/db/schema": schema, "@/lib/auth": { getSessionUser: async () => user } };
      common["@/lib/api"] = load("../lib/api.ts", common);
      common["@/lib/upload-limits"] = load("../lib/upload-limits.ts", common);
      common["@/lib/file-cleanup"] = { uploadPath: (name) => name, tryFileCleanup: async () => { const jobs = await db.select().from(fileCleanup); for (const job of jobs) if (files.has(job.storedName)) { files.delete(job.storedName); await db.delete(fileCleanup).where(eq(fileCleanup.storedName, job.storedName)); } } };
      common["node:fs/promises"] = { mkdir: async () => {}, writeFile: async (name) => { files.add(name); } };
      let logFails = true;
      common["@/lib/activity"] = { logActivity: async () => { if (logFails) throw new Error("log failed"); } };
      const route = load("../app/api/projects/[id]/files/route.ts", common);
      const request = () => { const form = new FormData(); form.set("file", new File(["content"], "test.txt")); return new Request("http://localhost/api", { method: "POST", body: form }); };
      const context = { params: Promise.resolve({ id: String(project.id) }) };
      assert.equal((await route.POST(request(), context)).status, 500);
      assert.equal((await db.select().from(attachments).where(eq(attachments.projectId, project.id))).length, 0);
      assert.equal(files.size, 0);
      logFails = false;
      assert.equal((await route.POST(request(), context)).status, 201);
      assert.equal((await db.select().from(attachments).where(eq(attachments.projectId, project.id))).length, 1);
      assert.equal(files.size, 1);
      throw rollback;
    }), (e) => e === rollback);
  } finally { await client.end(); }
});
