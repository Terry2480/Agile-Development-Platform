import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
function moduleAt(path, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, { exports, process, require: name => overrides[name] ?? require(name) });
  return exports;
}
const schema = moduleAt("../db/schema.ts");
const { users, sessions } = schema;
const presence = moduleAt("../lib/presence.ts");

test("presence and session activity stay correct in UTC and Beijing database timezones", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const database = drizzle(client);
  const rollback = new Error("rollback presence fixtures");
  try {
    await assert.rejects(database.transaction(async tx => {
      const suffix = randomUUID();
      const [user] = await tx.insert(users).values({
        email: `${suffix}@example.test`, studentId: suffix, name: "在线测试", passwordHash: "test-only",
      }).returning();
      const auth = moduleAt("../lib/auth.ts", {
        "@/db": { db: tx }, "@/db/schema": schema, "./presence": presence,
        "./request-security": { sessionCookie: token => `agile_session=${token}` },
      });
      const now = presence.sessionNow();
      const online = async () => (await tx.select({ online: presence.memberOnline(users.id) })
        .from(users).where(eq(users.id, user.id)))[0].online;
      for (const timezone of ["UTC", "Asia/Shanghai"]) {
        await tx.execute(sql`select set_config('TimeZone', ${timezone}, true)`);
        const cookie = await auth.createSession(user.id);
        const token = cookie.split("=")[1];
        const request = new Request("http://localhost/api", { headers: { cookie } });
        const update = values => tx.update(sessions).set(values).where(eq(sessions.token, token));
        assert.equal(await online(), true, `${timezone}: online immediately after login`);
        // Older UTC wall-clock sessions must also work without migrating data.
        await update({ lastActiveAt: sql`${now} - interval '2 minutes'` });
        assert.equal((await auth.getSessionUser(request)).id, user.id);
        const [row] = await tx.select().from(sessions).where(eq(sessions.token, token));
        assert.equal(row.lastActiveAt.getTime(), (await tx.select({ utc: now.mapWith(sessions.lastActiveAt) }).from(sessions).limit(1))[0].utc.getTime());
        await update({ lastActiveAt: sql`${now} - interval '30 seconds'` });
        const [before] = await tx.select().from(sessions).where(eq(sessions.token, token));
        await auth.getSessionUser(request);
        const [after] = await tx.select().from(sessions).where(eq(sessions.token, token));
        assert.equal(after.lastActiveAt.getTime(), before.lastActiveAt.getTime(), "activity writes are throttled");
        await update({ lastActiveAt: sql`${now} - interval '5 minutes'` });
        assert.equal(await online(), false, "inactive session becomes offline");
        await auth.getSessionUser(request);
        assert.equal(await online(), true, "next request restores online status");
        await update({ lastActiveAt: null });
        assert.equal(await online(), false);
        await auth.getSessionUser(request);
        assert.equal(await online(), true);
        await update({ expiresAt: sql`${now} - interval '1 second'` });
        assert.equal(await auth.getSessionUser(request), null, "expired login cannot refresh presence");
        assert.equal(await online(), false);
        const secondCookie = await auth.createSession(user.id);
        assert.equal(await online(), true, "another valid session keeps the user online");
        await auth.destroySession(secondCookie.split("=")[1]);
        assert.equal(await online(), false, "logout removes the active session");
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
      }
      throw rollback;
    }), error => error === rollback);
  } finally {
    await client.end();
  }
});
