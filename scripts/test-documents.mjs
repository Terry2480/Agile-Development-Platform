// Rehearsal entry point: never modifies .env.local or selects the ordinary app database.
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const name = process.env.DOCUMENT_REHEARSAL_DATABASE || "agilecampus_test_documents_20261112_v3";
if (!/^agilecampus_test_documents_[a-zA-Z0-9_]+$/.test(name)) throw new Error("ISOLATED_DATABASE_NAME_REQUIRED");
url.pathname = `/${name}`;
console.log(`Document rehearsal database: ${name}`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/document-migration.test.mjs"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString(), DOCUMENT_REHEARSAL: "1" },
});
if (result.error) console.error("Test runner failed:", result.error.code);
process.exitCode = result.status ?? 1;
