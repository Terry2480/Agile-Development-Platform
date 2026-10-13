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

const { users, teams, teamMembers, projects, sprints, activities } = schema;
const permissions = moduleAt("../lib/sprint-permissions.ts", { "./team-duties": duties });

test("only leaders create sprints; rejected or failed requests preserve the current sprint", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const rollback = new Error("rollback sprint fixtures");
  try {
    await assert.rejects(drizzle(client).transaction(async tx => {
      const suffix = randomUUID();
      const [owner, admin, member, leader, outsider] = await tx.insert(users).values(
        ["owner", "admin", "member", "leader", "outsider"].map(name => ({ email: `${name}-${suffix}@example.test`, studentId: `${name}-${suffix}`, name, passwordHash: "test-only" }))
      ).returning();
      const [team] = await tx.insert(teams).values({ name: "迭代权限测试", ownerId: owner.id }).returning();
      await tx.insert(teamMembers).values([
        { teamId: team.id, userId: owner.id, role: "owner" },
        { teamId: team.id, userId: admin.id, role: "admin" },
        { teamId: team.id, userId: member.id, role: "member", duties: ["开发者"] },
        { teamId: team.id, userId: leader.id, role: "member", duties: ["开发者", duties.LEADER_DUTY] },
      ]);
      const [project] = await tx.insert(projects).values({ teamId: team.id, name: "迭代权限", key: "SP" }).returning();
      const [original] = await tx.insert(sprints).values({ projectId: project.id, name: "原迭代", status: "active" }).returning();
      const context = { params: Promise.resolve({ id: String(project.id) }) };
      let actor = owner;
      let failLog = false;
      const common = { "@/db": { db: tx }, "@/db/schema": schema, "@/lib/team-duties": duties, "@/lib/auth": { getSessionUser: async () => actor } };
      common["@/lib/api"] = moduleAt("../lib/api.ts", common);
      const activity = moduleAt("../lib/activity.ts", common);
      common["@/lib/activity"] = { logActivity: async (...args) => {
        if (failLog) throw new Error("injected log failure");
        return activity.logActivity(...args);
      } };
      const route = moduleAt("../app/api/projects/[id]/sprints/route.ts", common);
      const create = () => route.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ name: "新迭代", status: "active" }) }), context);
      const read = () => tx.select().from(sprints).where(eq(sprints.projectId, project.id));
      for (const denied of [member, admin, outsider]) {
        actor = denied;
        assert.equal((await create()).status, denied === outsider ? 404 : 403);
        const rows = await read();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, "active");
      }
      actor = member;
      assert.equal((await route.GET(new Request("http://localhost/api"), context)).status, 200, "members retain read access");
      actor = owner;
      failLog = true;
      assert.equal((await create()).status, 500);
      assert.equal((await read()).length, 1);
      assert.equal((await read())[0].status, "active", "log failure rolls back changes");
      failLog = false;
      assert.equal((await create()).status, 201, "owner is implicitly a leader");
      actor = leader;
      assert.equal((await create()).status, 201, "multi-label leader can create");
      const rows = await read();
      assert.equal(rows.filter(row => row.status === "active").length, 1);
      assert.equal(rows.find(row => row.id === original.id).status, "planned");
      assert.equal((await tx.select().from(activities).where(eq(activities.projectId, project.id))).length, 2);
      await tx.update(teamMembers).set({ duties: ["开发者"], duty: null }).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, leader.id)));
      assert.equal((await create()).status, 403, "revoked leadership blocks subsequent creation");
      const members = await tx.select({ userId: teamMembers.userId, role: teamMembers.role, duty: teamMembers.duty, duties: teamMembers.duties }).from(teamMembers).where(eq(teamMembers.teamId, team.id));
      const detail = { project, members };
      assert.equal(permissions.canCreateSprint(detail, project.id, owner.id), true);
      assert.equal(permissions.canCreateSprint(detail, project.id, admin.id), false);
      assert.equal(permissions.canCreateSprint(detail, project.id, leader.id), false);
      assert.equal(permissions.canCreateSprint(detail, project.id + 1, owner.id), false, "old project data cannot grant permission after switching");
      assert.equal(permissions.canCreateSprint(null, project.id, owner.id), false);
      throw rollback;
    }), error => error === rollback);
  } finally { await client.end(); }
});
