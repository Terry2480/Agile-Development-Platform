import { config } from "dotenv";
import { spawnSync } from "node:child_process";
config({ path: ".env.local", quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("LOCAL_DATABASE_REQUIRED");
url.pathname = "/agilecampus_test_documents_20261112_v3";
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/document-api.test.mjs"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString(), DOCUMENT_API_TEST: "1" },
});
process.exitCode = result.status ?? 1;
