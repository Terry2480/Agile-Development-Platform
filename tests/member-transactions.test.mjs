import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
function moduleAt(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, process, Response, URL, console: { error() {} }, require: (name) => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");
const { users, teams, teamMembers, projects, projectMembers } = schema;

test("member changes and project creation commit together or fully roll back on sync failure", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const database = drizzle(client);
  const rollback = new Error("rollback test fixtures");
  try {
    await assert.rejects(database.transaction(async (outer) => {
      const suffix = randomUUID();
      const [owner, candidate] = await outer.insert(users).values(["owner", "candidate"].map((name) => ({ email: `${name}-${suffix}@example.test`, studentId: `${name}-${suffix}`, passwordHash: "test-only", name }))).returning();
      const [team] = await outer.insert(teams).values({ name: "事务测试", ownerId: owner.id }).returning();
      await outer.insert(teamMembers).values({ teamId: team.id, userId: owner.id, role: "owner" });
      await outer.insert(projects).values(["AA", "BB"].map((key) => ({ teamId: team.id, name: key, key })));
      function routes(failure, actor = owner) {
        const wrap = (base) => new Proxy(base, { get(target, property) {
          if (property === "transaction") return (callback) => target.transaction((tx) => callback(wrap(tx)));
          if (property === failure) return (table) => { if (table === projectMembers) throw new Error("injected project sync failure"); return target[property](table); };
          const value = target[property]; return typeof value === "function" ? value.bind(target) : value;
        } });
        const db = wrap(outer);
        const common = { "@/db": { db }, "@/db/schema": schema, "@/lib/auth": { getSessionUser: async () => actor }, "@/lib/file-cleanup": { tryFileCleanup: async () => {} } };
        common["@/lib/api"] = moduleAt("../lib/api.ts", common);
        common["@/lib/activity"] = moduleAt("../lib/activity.ts", common);
        return {
          add: moduleAt("../app/api/teams/[id]/members/route.ts", common).POST,
          remove: moduleAt("../app/api/teams/[id]/members/[userId]/route.ts", common).DELETE,
          create: moduleAt("../app/api/projects/route.ts", common).POST,
        };
      }
      const context = { params: Promise.resolve({ id: String(team.id), userId: String(candidate.id) }) };
      const addRequest = () => new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ email: candidate.email }) });
      const membership = () => outer.select().from(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, candidate.id)));
      const projectMembership = () => outer.select().from(projectMembers).where(eq(projectMembers.userId, candidate.id));
      assert.equal((await routes("insert").add(addRequest(), context)).status, 500);
      assert.equal((await membership()).length, 0);
      assert.equal((await projectMembership()).length, 0);
      assert.equal((await routes().add(addRequest(), context)).status, 201);
      assert.equal((await membership()).length, 1);
      assert.equal((await projectMembership()).length, 2);
      assert.equal((await routes().add(addRequest(), context)).status, 409);
      assert.equal((await routes("delete").remove(new Request("http://localhost/api", { method: "DELETE" }), context)).status, 500);
      assert.equal((await membership()).length, 1);
      assert.equal((await projectMembership()).length, 2);
      assert.equal((await routes().remove(new Request("http://localhost/api", { method: "DELETE" }), context)).status, 200);
      assert.equal((await membership()).length, 0);
      assert.equal((await projectMembership()).length, 0);
      assert.equal((await routes(undefined, candidate).add(addRequest(), context)).status, 403);
      const response = await routes("insert").create(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ teamId: team.id, name: "失败项目", key: "CC" }) }));
      assert.equal(response.status, 500);
      assert.equal((await outer.select().from(projects).where(and(eq(projects.teamId, team.id), eq(projects.key, "CC")))).length, 0);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await client.end(); }
});
