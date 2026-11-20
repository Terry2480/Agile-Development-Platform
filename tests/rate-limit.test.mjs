import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID, createHash } from "node:crypto";
import ts from "typescript";
import postgres from "postgres";
import { config } from "dotenv";
import { PgDialect } from "drizzle-orm/pg-core";

config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../lib/rate-limit.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test("database limiter is atomic across simultaneous calls, isolates keys and resets expired windows", async () => {
  const client = postgres(process.env.DATABASE_URL, { max: 8 });
  const keys = ["regression:" + randomUUID(), "regression:" + randomUUID()];
  const hashes = keys.map((key) => createHash("sha256").update(key).digest("hex"));
  const exports = {};
  runInNewContext(source, { exports, process, Response, require: (name) => name === "@/db" ? { db: { execute: async (sql) => { const query = new PgDialect().sqlToQuery(sql); return client.unsafe(query.sql, query.params); } } } : require(name) });
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => exports.consumeLimit(keys[0], 3, 900)));
    assert.equal(results.filter((r) => r === null).length, 3);
    assert.equal(results.filter((r) => r?.status === 429).length, 5);
    assert.ok(Number(results.find((r) => r)?.headers.get("Retry-After")) > 0);
    assert.equal(await exports.consumeLimit(keys[1], 3, 900), null);
    await client`UPDATE auth_rate_limits SET expires_at = now() - interval '1 second' WHERE key = ${hashes[0]}`;
    assert.equal(await exports.consumeLimit(keys[0], 3, 900), null);
  } finally {
    await client`DELETE FROM auth_rate_limits WHERE key IN (${hashes[0]}, ${hashes[1]})`;
    await client.end();
  }
});
