// Offline development tool: generate only the additive document-table DDL, never connects to a database.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import ts from "typescript";
if(existsSync(new URL("migrations/001-documents.sql",import.meta.url)))throw Error("Migration 001 is frozen. Add a numbered incremental migration instead of regenerating it.");
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("schema.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: createRequire(import.meta.url) });
const legacy = Object.fromEntries(Object.entries(exports).filter(([key]) => !key.startsWith("document")));
const statements = await generateMigration(generateDrizzleJson(legacy), generateDrizzleJson(exports));
if (statements.some(s => /^(DROP|ALTER TABLE "(?!document_))/i.test(s))) throw new Error("Expected additive document-only DDL");
mkdirSync(new URL("migrations/", import.meta.url), { recursive: true });
writeFileSync(new URL("migrations/001-documents.sql", import.meta.url),
  "-- Generated from db/schema.ts; regenerate offline with node db/generate-document-ddl.mjs.\n" + statements.join("\n--> statement-breakpoint\n") + "\n");
console.log(`Generated ${statements.length} additive DDL statements`);
