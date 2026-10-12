import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { pgTable, integer, text, timestamp, PgDialect } from "drizzle-orm/pg-core";

const require = createRequire(import.meta.url);
const tasks = pgTable("tasks", { id: integer("id"), projectId: integer("project_id") });
const users = pgTable("users", { id: integer("id"), name: text("name"), studentId: text("student_id") });
const attachments = pgTable("attachments", { id: integer("id"), projectId: integer("project_id"), taskId: integer("task_id"), originalName: text("original_name"), mimeType: text("mime_type"), size: integer("size"), createdAt: timestamp("created_at"), uploaderId: integer("uploader_id") });
const source = ts.transpileModule(readFileSync(new URL("../app/api/projects/[id]/files/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function load({ taskExists = true, allowed = true } = {}) {
  const queries = [];
  const db = { select() {
    let table;
    const chain = {
      from(value) { table = value; return chain; },
      innerJoin() { return chain; },
      where(condition) { queries.push({ table, ...new PgDialect().sqlToQuery(condition) }); return chain; },
      limit() { return Promise.resolve(taskExists ? [{ id: 11 }] : []); },
      orderBy() { return Promise.resolve([{ id: 1, originalName: "课程材料.pdf" }]); },
    };
    return chain;
  } };
  const exports = {};
  const api = {
    requireUser: async () => ({ id: 1 }),
    requireProjectAccess: async () => { if (!allowed) throw new ApiError(403, "无权访问"); },
    parseId: (value) => { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "编号不合法"); return id; },
    ApiError,
    handleApiError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }),
  };
  runInNewContext(source, { exports, Response, URL, require: (name) => {
    if (name === "@/db") return { db };
    if (name === "@/db/schema") return { tasks, users, attachments };
    if (name === "@/lib/api") return api;
    if (name === "@/lib/activity") return {};
    if (name === "@/lib/file-cleanup") return {};
    return require(name);
  }, process });
  return { GET: exports.GET, queries };
}
const context = { params: Promise.resolve({ id: "7" }) };
test("cross-project or nonexistent task is rejected before listing any attachments", async () => {
  const { GET, queries } = load({ taskExists: false });
  const response = await GET(new Request("http://localhost/api/projects/7/files?taskId=99"), context);
  assert.equal(response.status, 404);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [7, 99]);
  assert.equal(queries[0].table, tasks);
});
test("task attachment query always includes both project and task constraints", async () => {
  const { GET, queries } = load();
  const response = await GET(new Request("http://localhost/api/projects/7/files?taskId=11"), context);
  assert.equal(response.status, 200);
  assert.deepEqual(queries[1].params, [7, 11]);
  assert.match(queries[1].sql, /project_id/);
  assert.match(queries[1].sql, /task_id/);
});
test("whole-project list remains scoped to project", async () => {
  const { GET, queries } = load();
  assert.equal((await GET(new Request("http://localhost/api/projects/7/files"), context)).status, 200);
  assert.deepEqual(queries[0].params, [7]);
});
test("invalid task ids and denied projects never query attachments", async () => {
  for (const value of ["", "abc", "0", "-1", "1.5"]) {
    const { GET, queries } = load();
    assert.equal((await GET(new Request(`http://localhost/api/projects/7/files?taskId=${value}`), context)).status, 400);
    assert.equal(queries.length, 0);
  }
  const { GET, queries } = load({ allowed: false });
  assert.equal((await GET(new Request("http://localhost/api/projects/7/files?taskId=11"), context)).status, 403);
  assert.equal(queries.length, 0);
});
