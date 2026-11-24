import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, { exports, process, Request, Response, Buffer, File, URL, console,
    require: name => overrides[name] ?? require(name) });
  return exports;
}

test("phase-2 baseline: two teams and three accounts", async t => {
  // Deliberately do not load .env.local: require an explicitly selected isolated database.
  assert.ok(process.env.DATABASE_URL, "explicit test DATABASE_URL is required");
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.equal(target.pathname, "/agilecampus_test_20261112", "refuse writes to any other database");
  const client = postgres(target.toString(), { max: 1, connect_timeout: 3 });
  const schema = load("../db/schema.ts");
  const { users, teams, teamMembers, projects, tasks, milestones, milestoneTasks, attachments, milestoneResources } = schema;
  const suffix = randomUUID();
  const rollback = new Error("rollback baseline samples");
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "agile-baseline-"));
  try {
    await assert.rejects(drizzle(client).transaction(async tx => {
      const shared = { "@/db": { db: tx }, "@/db/schema": schema };
      shared["./presence"] = load("../lib/presence.ts", shared);
      shared["./request-security"] = load("../lib/request-security.ts");
      const auth = load("../lib/auth.ts", shared);
      shared["@/lib/auth"] = auth;
      const api = load("../lib/api.ts", shared);
      shared["@/lib/api"] = api;
      shared["./api"] = api;
      shared["@/lib/rate-limit"] = load("../lib/rate-limit.ts", shared);
      shared["@/lib/activity"] = load("../lib/activity.ts", shared);
      shared["./dm"] = load("../lib/dm.ts", shared);
      shared["@/lib/documents/lifecycle"] = { documentsEnabled: async () => false };
      shared["./notify"] = load("../lib/notify.ts", shared);
      shared["@/lib/task-collaborators"] = load("../lib/task-collaborators.ts", shared);
      const password = `Baseline-${suffix}`;
      const [alice, bob, carol] = await tx.insert(users).values(["alice", "bob", "carol"].map(name => ({
        email: `${name}-${suffix}@example.test`, studentId: `${name}-${suffix}`,
        name, passwordHash: auth.hashPassword(password),
      }))).returning();
      const [teamA, teamB] = await tx.insert(teams).values([
        { name: "基线团队 A", ownerId: alice.id }, { name: "基线团队 B", ownerId: carol.id },
      ]).returning();
      await tx.insert(teamMembers).values([
        { teamId: teamA.id, userId: alice.id, role: "owner" },
        { teamId: teamA.id, userId: bob.id, role: "member" },
        { teamId: teamB.id, userId: carol.id, role: "owner" },
      ]);
      const [projectA, projectB] = await tx.insert(projects).values([
        { teamId: teamA.id, name: "课程 A", key: "BLA" },
        { teamId: teamB.id, name: "课程 B", key: "BLB" },
      ]).returning();
      const [task] = await tx.insert(tasks).values({ projectId: projectA.id, number: 1,
        title: "提交报告", assigneeId: bob.id }).returning();
      const [milestone] = await tx.insert(milestones).values({ projectId: projectA.id,
        name: "期末交付", dueOn: "2026-11-25" }).returning();
      await tx.insert(milestoneTasks).values({ milestoneId: milestone.id, taskId: task.id });
      const [file] = await tx.insert(attachments).values({ projectId: projectA.id, taskId: task.id,
        uploaderId: alice.id, originalName: "报告样例.txt", storedName: `baseline-${suffix}.txt`, size: 6 }).returning();
      await tx.insert(milestoneResources).values({ milestoneId: milestone.id, attachmentId: file.id,
        createdById: alice.id, title: "报告样例" });

      await t.test("login and task routes plus real isolated file upload/download", async () => {
        const login = load("../app/api/auth/login/route.ts", shared);
        const loginRequest = passwordValue => new Request("http://localhost/api/auth/login", {
          method: "POST", body: JSON.stringify({ email: bob.email, password: passwordValue }),
        });
        assert.equal((await login.POST(loginRequest("wrong"))).status, 401);
        const response = await login.POST(loginRequest(password));
        assert.equal(response.status, 200);
        const cookie = response.headers.get("set-cookie").split(";")[0];
        const request = (url, options = {}) => new Request(`http://localhost${url}`, { ...options, headers: { cookie } });
        const taskRoutes = load("../app/api/tasks/route.ts", shared);
        const created = await taskRoutes.POST(request("/api/tasks", { method: "POST",
          body: JSON.stringify({ projectId: projectA.id, title: "接口冒烟任务", assigneeId: bob.id }) }));
        assert.equal(created.status, 201);
        const listed = await taskRoutes.GET(request(`/api/tasks?projectId=${projectA.id}`));
        assert.equal(listed.status, 200);
        assert.ok((await listed.json()).tasks.some(item => item.title === "接口冒烟任务"));
        assert.equal((await taskRoutes.GET(request(`/api/tasks?projectId=${projectB.id}`))).status, 404);

        // Redirect only the upload root; use real filesystem IO in an isolated temporary directory.
        const isolated = { ...shared, "node:path": { ...path, join: (...parts) =>
          parts[0] === process.cwd() && parts[1] === "uploads"
            ? path.join(uploadDir, ...parts.slice(2)) : path.join(...parts) },
        "@/lib/file-cleanup": { uploadPath: name => path.join(uploadDir, name), tryFileCleanup: async () => {} },
        "@/lib/upload-limits": load("../lib/upload-limits.ts") };
        const files = load("../app/api/projects/[id]/files/route.ts", isolated);
        const download = load("../app/api/files/[id]/route.ts", isolated);
        const content = "真实附件冒烟样例\n";
        const form = new FormData();
        form.set("file", new File([content], "冒烟样例.txt", { type: "text/plain" }));
        form.set("taskId", String(task.id));
        const uploaded = await files.POST(request("/api/files", { method: "POST", body: form }),
          { params: Promise.resolve({ id: String(projectA.id) }) });
        assert.equal(uploaded.status, 201);
        const fileId = (await uploaded.json()).file.id;
        const context = { params: Promise.resolve({ id: String(fileId) }) };
        const downloaded = await download.GET(request(`/api/files/${fileId}`), context);
        assert.equal(downloaded.status, 200);
        assert.equal(await downloaded.text(), content);
        assert.equal(Number(downloaded.headers.get("content-length")), Buffer.byteLength(content));
        assert.equal((await download.GET(new Request("http://localhost/api/files"), context)).status, 401);
        const outsiderCookie = (await auth.createSession(carol.id)).split(";")[0];
        assert.equal((await download.GET(new Request("http://localhost/api/files", {
          headers: { cookie: outsiderCookie },
        }), context)).status, 404);
      });

      await t.test("password verification rejects wrong credentials", () => {
        assert.equal(auth.verifyPassword(password, bob.passwordHash), true);
        assert.equal(auth.verifyPassword("wrong", bob.passwordHash), false);
      });
      await t.test("real session creation, authentication and logout", async () => {
        const cookie = await auth.createSession(bob.id);
        const request = new Request("http://localhost/api/auth/me", { headers: { cookie: cookie.split(";")[0] } });
        assert.equal((await auth.getSessionUser(request)).id, bob.id);
        await auth.destroySession(auth.readToken(request));
        assert.equal(await auth.getSessionUser(request), null);
      });
      await t.test("member reads own project but cannot request admin privileges", async () => {
        assert.equal((await api.requireProjectAccess(bob.id, projectA.id)).project.id, projectA.id);
        await assert.rejects(api.requireProjectAccess(bob.id, projectA.id, "admin"), e => e.status === 403);
      });
      await t.test("team B owner cannot access team A and vice versa", async () => {
        await assert.rejects(api.requireProjectAccess(carol.id, projectA.id), e => e.status === 404);
        await assert.rejects(api.requireProjectAccess(alice.id, projectB.id), e => e.status === 404);
      });
      await t.test("one attachment retains task and milestone associations", async () => {
        const rows = await tx.select().from(attachments)
          .innerJoin(milestoneResources, eq(milestoneResources.attachmentId, attachments.id))
          .where(eq(attachments.id, file.id));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].attachments.taskId, task.id);
        assert.equal(rows[0].milestone_resources.milestoneId, milestone.id);
      });
      await t.test("leaving team immediately revokes access", async () => {
        await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamA.id), eq(teamMembers.userId, bob.id)));
        await assert.rejects(api.requireProjectAccess(bob.id, projectA.id), e => e.status === 404);
      });
      throw rollback;
    }), error => error === rollback);
    assert.equal((await client`select id from users where email like ${`%-${suffix}@example.test`}`).length, 0);
  } finally {
    await client.end();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
