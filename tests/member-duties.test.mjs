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
  runInNewContext(source, { exports, process, Response, URL, console: { error() {} }, require: name => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");
const duties = moduleAt("../lib/team-duties.ts");
const { users, teams, teamMembers } = schema;

test("multiple member duties persist, protect the owner and recheck leader permissions", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const rollback = new Error("rollback duty fixtures");
  try {
    await assert.rejects(drizzle(client).transaction(async tx => {
      const suffix = randomUUID();
      const [owner, member] = await tx.insert(users).values(["owner", "member"].map(name => ({ email: `${name}-${suffix}@example.test`, studentId: `${name}-${suffix}`, name, passwordHash: "test-only" }))).returning();
      const [team] = await tx.insert(teams).values({ name: "多标签测试", ownerId: owner.id }).returning();
      await tx.insert(teamMembers).values([{ teamId: team.id, userId: owner.id, role: "owner" }, { teamId: team.id, userId: member.id, role: "member", duty: "开发者" }]);
      let actor = owner;
      const common = { "@/db": { db: tx }, "@/db/schema": schema, "@/lib/team-duties": duties, "@/lib/auth": { getSessionUser: async () => actor } };
      common["@/lib/api"] = moduleAt("../lib/api.ts", common);
      const put = moduleAt("../app/api/teams/[id]/members/[userId]/duty/route.ts", common).PUT;
      const assign = (userId, labels) => put(new Request("http://localhost/api", { method: "PUT", body: JSON.stringify({ duties: labels }) }), { params: Promise.resolve({ id: String(team.id), userId: String(userId) }) });
      const read = async userId => (await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId))))[0];
      actor = member;
      assert.equal((await assign(member.id, [duties.LEADER_DUTY])).status, 403, "member cannot grant themselves leader access");
      actor = owner;
      assert.equal((await assign(member.id, [" 开发者 ", "展示人", "文档", "开发者"])).status, 200);
      assert.deepEqual((await read(member.id)).duties, ["开发者", "展示人", "文档"]);
      assert.equal((await assign(owner.id, ["开发者"])).status, 400);
      assert.equal((await assign(owner.id, [duties.LEADER_DUTY, "开发者"])).status, 200);
      assert.equal((await assign(member.id, ["开发者", duties.LEADER_DUTY])).status, 200);
      actor = member;
      assert.equal((await assign(owner.id, [duties.LEADER_DUTY, "展示人"])).status, 200, "leader works even when not first in the list");
      assert.equal((await assign(member.id, [])).status, 200);
      assert.deepEqual((await read(member.id)).duties, []);
      assert.equal((await read(member.id)).duty, null);
      assert.equal((await assign(member.id, [duties.LEADER_DUTY])).status, 403, "removed leader cannot reassign duties");
      actor = owner;
      assert.equal((await assign(member.id, [" "])).status, 400);
      assert.deepEqual((await read(member.id)).duties, []);
      throw rollback;
    }), error => error === rollback);
  } finally { await client.end(); }
});
