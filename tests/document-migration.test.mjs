import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import ts from "typescript";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableConfig } from "drizzle-orm/pg-core";
import { migrateDocuments } from "../db/add-documents.ts";

const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, { exports, process, console, require: name => overrides[name] ?? require(name) });
  return exports;
}
const empty = { type: "doc", content: [] };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("document schema and legacy migration rehearsal", {
  skip: process.env.DOCUMENT_REHEARSAL !== "1" ? "Use npm run test:documents for the explicitly isolated migration rehearsal" : false,
}, async t => {
  assert.ok(process.env.DATABASE_URL, "explicit isolated DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/agilecampus_test_documents_[a-zA-Z0-9_]+$/);
  const sql = postgres(url.toString(), { max: 4, connect_timeout: 3, onnotice: () => {} });
  const rollback = new Error("rollback constraint fixture");
  async function rolled(fn) {
    await assert.rejects(sql.begin(async tx => { await fn(tx); await tx`SET CONSTRAINTS ALL IMMEDIATE`; throw rollback; }), e => e === rollback);
  }
  async function rejects(fn, code = "23514") {
    await assert.rejects(sql.begin(async tx => { await fn(tx); await tx`SET CONSTRAINTS ALL IMMEDIATE`; }), e => e.code === code);
  }
  try {
    // Stable committed migration fixtures make repeated rehearsal itself testable.
    let [actor] = await sql`SELECT id FROM users WHERE email='document-migration-owner@example.test'`;
    if (!actor) await sql.begin(async tx => {
      const [a] = await tx`INSERT INTO users(email,student_id,password_hash,name) VALUES('document-migration-owner@example.test','doc-migration-owner','test-only','迁移负责人') RETURNING id`;
      const [b] = await tx`INSERT INTO users(email,student_id,password_hash,name) VALUES('document-migration-outsider@example.test','doc-migration-outsider','test-only','外部负责人') RETURNING id`;
      const [team] = await tx`INSERT INTO teams(name,owner_id) VALUES('文档迁移演练 A',${a.id}) RETURNING id`;
      const [other] = await tx`INSERT INTO teams(name,owner_id) VALUES('文档迁移演练 B',${b.id}) RETURNING id`;
      await tx`INSERT INTO team_members(team_id,user_id,role) VALUES(${team.id},${a.id},'owner'),(${other.id},${b.id},'owner')`;
      const [project] = await tx`INSERT INTO projects(team_id,name,key) VALUES(${team.id},'迁移项目 A','DMA') RETURNING id`;
      await tx`INSERT INTO projects(team_id,name,key,status) VALUES(${team.id},'归档项目','DMB','archived'),(${other.id},'另一团队项目','DMC','active')`;
      const [task] = await tx`INSERT INTO tasks(project_id,number,title) VALUES(${project.id},1,'迁移任务') RETURNING id`;
      const [milestone] = await tx`INSERT INTO milestones(project_id,name,due_on) VALUES(${project.id},'迁移交付','2026-11-25') RETURNING id`;
      const [file] = await tx`INSERT INTO attachments(project_id,task_id,uploader_id,original_name,stored_name,mime_type,size) VALUES(${project.id},${task.id},${a.id},'报告.pdf','document-fixture-report-a.pdf','application/pdf',20) RETURNING id`;
      await tx`INSERT INTO attachments(project_id,uploader_id,original_name,stored_name,mime_type,size) VALUES(${project.id},${a.id},'报告.pdf','document-fixture-report-b.pdf','application/pdf',30)`;
      await tx`INSERT INTO milestone_resources(milestone_id,attachment_id,title,created_by_id) VALUES(${milestone.id},${file.id},'报告',${a.id})`;
      await tx`INSERT INTO milestone_resources(milestone_id,title,url,created_by_id) VALUES(${milestone.id},'课程原型','https://example.test/prototype',${a.id})`;
    });
    [actor] = await sql`SELECT id FROM users WHERE email='document-migration-owner@example.test'`;
    const [project] = await sql`SELECT id,team_id FROM projects WHERE key='DMA'`;
    const [otherProject] = await sql`SELECT id,team_id FROM projects WHERE key='DMC'`;
    const before = await sql`SELECT id,stored_name,size FROM attachments ORDER BY id`;

    await t.test("additive schema/backfill preserves legacy metadata and references", async () => {
      const result = await migrateDocuments(sql, { backfill: true });
      assert.ok(["applied", "already-applied"].includes(result.schema));
      assert.deepEqual(await sql`SELECT id,stored_name,size FROM attachments ORDER BY id`, before);
      const [count] = await sql`SELECT count(*)::int AS n FROM document_legacy_files`;
      assert.equal(count.n, 2);
      const [links] = await sql`SELECT count(*)::int AS n FROM document_legacy_links`;
      assert.equal(links.n, 1);
      assert.equal((await sql`SELECT id FROM document_associations`).length, 3);
      assert.equal((await sql`SELECT id FROM document_spaces`).length, 5);
      const rows = await sql`SELECT n.name FROM document_nodes n JOIN document_legacy_files f ON f.node_id=n.id`;
      assert.equal(new Set(rows.map(x => x.name)).size, 2, "same-name historical files receive distinct labels");
    });
    const [space] = await sql`SELECT id FROM document_spaces WHERE project_id=${project.id}`;
    const [otherSpace] = await sql`SELECT id FROM document_spaces WHERE project_id=${otherProject.id}`;
    const [parent] = await sql`SELECT node_id AS id FROM document_migration_roots WHERE space_id=${space.id} AND role='default-documents'`;
    const [otherParent] = await sql`SELECT node_id AS id FROM document_migration_roots WHERE space_id=${otherSpace.id} AND role='default-documents'`;
    const [legacy] = await sql`SELECT f.node_id AS id,f.legacy_attachment_id,r.resource_id FROM document_legacy_files f JOIN document_file_entries r ON r.node_id=f.node_id ORDER BY f.legacy_attachment_id LIMIT 1`;
    async function doc(tx, name = "约束文档", targetSpace = space.id, targetParent = parent.id) {
      const [n] = await tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${targetSpace},${targetParent},'document',${name},${name.toLowerCase()}) RETURNING id`;
      await tx`INSERT INTO document_bodies(node_id,content_json,content_hash) VALUES(${n.id},${tx.json(empty)},${hash(empty)})`;
      return n.id;
    }
    async function resource(tx, team = project.team_id) {
      const [r] = await tx`INSERT INTO document_resources(team_id,stored_name,original_name,mime_type,size) VALUES(${team},${randomUUID()+'.png'},'图片.png','image/png',5) RETURNING id`;
      return r.id;
    }

    await t.test("all Drizzle document fields, foreign keys and checks match installed schema", async () => {
      const tables = Object.entries(load("../db/schema.ts")).filter(([key]) => key.startsWith("document")).map(([, value]) => getTableConfig(value));
      assert.equal(tables.length, 22);
      const columns = await sql`SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'document_%'`;
      const constraints = new Set((await sql`SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace`).map(x => x.conname));
      const indexes = new Set((await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public'`).map(x => x.indexname));
      for (const table of tables) {
        for (const col of table.columns) {
          const actual = columns.find(x => x.table_name === table.name && x.column_name === col.name);
          assert.ok(actual, `${table.name}.${col.name} exists`);
          assert.equal(actual.is_nullable, col.notNull ? "NO" : "YES", `${table.name}.${col.name} nullability`);
        }
        // PostgreSQL truncates these ASCII-generated identifiers to NAMEDATALEN - 1 bytes.
        for (const fk of table.foreignKeys) assert.ok(constraints.has(fk.getName().slice(0, 63)), fk.getName());
        for (const ck of table.checks) assert.ok(constraints.has(ck.name), ck.name);
        for (const ix of table.indexes) assert.ok(indexes.has(ix.config.name), ix.config.name);
      }
    });

    await t.test("re-running migration keeps renamed/moved files and creates no duplicates", async () => {
      await sql`UPDATE document_nodes SET name='已整理的报告',normalized_name='已整理的报告',parent_id=${parent.id} WHERE id=${legacy.id}`;
      const [beforeCounts] = await sql`SELECT (SELECT count(*) FROM document_nodes) AS nodes,(SELECT count(*) FROM document_resources) AS resources`;
      const result = await migrateDocuments(sql, { backfill: true });
      assert.equal(result.backfill.status, "already-applied");
      const [afterCounts] = await sql`SELECT (SELECT count(*) FROM document_nodes) AS nodes,(SELECT count(*) FROM document_resources) AS resources`;
      assert.deepEqual(afterCounts, beforeCounts);
      assert.equal((await sql`SELECT name FROM document_nodes WHERE id=${legacy.id}`)[0].name, "已整理的报告");
    });
    await t.test("legacy write adapter guard prevents accidental cascade data loss", async () => {
      await rejects(tx => tx`DELETE FROM attachments WHERE id=${legacy.legacy_attachment_id}`, "55000");
      await rejects(tx => tx`DELETE FROM projects WHERE id=${project.id}`, "55000");
    });
    await t.test("same-level case-insensitive uniqueness and valid names", async () => {
      await rejects(async tx => {
        await tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${parent.id},'folder','Report','report'),(${space.id},${parent.id},'folder','report','report')`;
      }, "23505");
      await rejects(tx => tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${parent.id},'folder','bad/name','bad/name')`);
      await rejects(tx => tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${parent.id},'folder',${'bad\\name'},${'bad\\name'})`);
    });
    await t.test("parent scope, folder-only parenting, cycles and last partition", async () => {
      await rejects(tx => tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${otherParent.id},'folder','跨空间父级','跨空间父级')`, "23503");
      await rejects(tx => tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${legacy.id},'folder','错误父级','错误父级')`);
      await rejects(tx => tx`UPDATE document_nodes SET parent_id=id WHERE id=${parent.id}`);
      await rejects(async tx => {
        const [team] = await tx`INSERT INTO teams(name,owner_id) VALUES('最后分区验证',${actor.id}) RETURNING id`;
        const [s] = await tx`INSERT INTO document_spaces(team_id) VALUES(${team.id}) RETURNING id`;
        const [n] = await tx`INSERT INTO document_nodes(space_id,kind,name,normalized_name) VALUES(${s.id},'folder','唯一分区','唯一分区') RETURNING id`;
        await tx`DELETE FROM document_nodes WHERE id=${n.id}`;
      });
    });
    await t.test("content kind must be complete at transaction end", async () => {
      await rejects(tx => tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${parent.id},'document','缺正文','缺正文')`);
      await rolled(async tx => { await doc(tx); });
      await rejects(async tx => {
        const id = await doc(tx);
        await tx`INSERT INTO document_link_entries(node_id,url) VALUES(${id},'https://example.test/')`;
      });
    });
    await t.test("resource owners cannot cross teams or refer to deleting files", async () => {
      await rejects(async tx => {
        const id = await doc(tx); const r = await resource(tx, otherProject.team_id);
        await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${r},${id},'body_image')`;
      });
      await rejects(async tx => {
        const id = await doc(tx); const r = await resource(tx);
        await tx`UPDATE document_resources SET state='deleting' WHERE id=${r}`;
        await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${r},${id},'body_image')`;
      });
    });
    await t.test("body/history image sets and reference records stay in sync", async () => {
      await rejects(async tx => {
        const id = await doc(tx); const r = await resource(tx);
        const body = { type: "doc", content: [{ type: "image", attrs: { resourceId: r } }] };
        await tx`UPDATE document_bodies SET content_json=${tx.json(body)},content_hash=${hash(body)} WHERE node_id=${id}`;
      });
      await rolled(async tx => {
        const id = await doc(tx); const r = await resource(tx);
        const body = { type: "doc", content: [{ type: "image", attrs: { resourceId: r } }] };
        await tx`UPDATE document_bodies SET content_json=${tx.json(body)},content_hash=${hash(body)} WHERE node_id=${id}`;
        await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${r},${id},'body_image')`;
        const [v] = await tx`INSERT INTO document_versions(node_id,content_json,content_hash,source_revision,body_author_name,reason) VALUES(${id},${tx.json(body)},${hash(body)},1,'测试作者','manual') RETURNING id`;
        await tx`INSERT INTO document_resource_refs(resource_id,version_id,role) VALUES(${r},${v.id},'version_image')`;
      });
    });
    await t.test("shared file replacement is independent and referenced resources are immutable", async () => {
      await rolled(async tx => {
        const [copy] = await tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name) VALUES(${space.id},${parent.id},'file','副本','副本') RETURNING id`;
        await tx`INSERT INTO document_file_entries(node_id,resource_id) VALUES(${copy.id},${legacy.resource_id})`;
        await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${legacy.resource_id},${copy.id},'file')`;
        const next = await resource(tx);
        await tx`UPDATE document_file_entries SET resource_id=${next} WHERE node_id=${copy.id}`;
        await tx`DELETE FROM document_resource_refs WHERE node_id=${copy.id} AND role='file'`;
        await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${next},${copy.id},'file')`;
        assert.equal((await tx`SELECT resource_id FROM document_file_entries WHERE node_id=${legacy.id}`)[0].resource_id, legacy.resource_id);
      });
      await rejects(tx => tx`UPDATE document_resources SET stored_name='changed' WHERE id=${legacy.resource_id}`);
      await rejects(tx => tx`UPDATE document_resources SET state='deleting' WHERE id=${legacy.resource_id}`);
    });
    await t.test("history upper bound is ten additional snapshots", async () => {
      await rejects(async tx => {
        const id = await doc(tx);
        for (let i = 0; i < 11; i++) await tx`INSERT INTO document_versions(node_id,content_json,content_hash,source_revision,body_author_name,reason) VALUES(${id},${tx.json(empty)},${hash(empty)},1,'测试作者','manual')`;
      });
    });
    await t.test("one edit session per document, membership and archive interlock", async () => {
      await rolled(async tx => {
        const id = await doc(tx);
        await tx`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor.id},${'a'.repeat(64)},clock_timestamp()+interval '1 minute')`;
        await assert.rejects(tx.savepoint(inner => inner`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor.id},${'b'.repeat(64)},clock_timestamp()+interval '1 minute')`), e => e.code === "23505");
        await assert.rejects(tx.savepoint(inner => inner`UPDATE projects SET status='archived' WHERE id=${project.id}`), e => e.code === "55000");
        await tx`DELETE FROM team_members WHERE team_id=${project.team_id} AND user_id=${actor.id}`;
        assert.equal((await tx`SELECT node_id FROM document_edit_locks WHERE node_id=${id}`).length, 0);
      });
    });
    await t.test("task and milestone association scope is enforced", async () => {
      await rejects(async tx => {
        const id = await doc(tx, "其他团队文档", otherSpace.id, otherParent.id);
        const [task] = await tx`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`;
        await tx`INSERT INTO document_associations(node_id,task_id) VALUES(${id},${task.id})`;
      });
    });
    await t.test("trash batches and single-item restore require consistent membership", async () => {
      await rolled(async tx => {
        const id = await doc(tx);
        const [batch] = await tx`INSERT INTO document_trash_batches(space_id,root_node_id) VALUES(${space.id},${id}) RETURNING id,deleted_at,expires_at`;
        // Copy timestamps inside PostgreSQL; round-tripping through JS Date loses microseconds.
        await tx`UPDATE document_nodes n SET state='trashed',trash_batch_id=b.id,deleted_at=b.deleted_at,expires_at=b.expires_at
          FROM document_trash_batches b WHERE b.id=${batch.id} AND n.id=${id}`;
        await tx`INSERT INTO document_trash_items(node_id,batch_id,original_parent_id,original_path,original_space_id,original_name)
          VALUES(${id},${batch.id},${parent.id},'[]'::jsonb,${space.id},'约束文档')`;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
        await tx`SET CONSTRAINTS ALL DEFERRED`;
        await assert.rejects(tx.savepoint(async inner => {
          await inner`UPDATE document_nodes SET state='active',trash_batch_id=NULL,deleted_at=NULL,expires_at=NULL WHERE id=${id}`;
          await inner`SET CONSTRAINTS ALL IMMEDIATE`;
        }), err => err.code === "23514");
        await tx`DELETE FROM document_trash_items WHERE node_id=${id}`;
        await tx`UPDATE document_nodes SET state='active',trash_batch_id=NULL,deleted_at=NULL,expires_at=NULL WHERE id=${id}`;
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
        assert.equal((await tx`SELECT state FROM document_nodes WHERE id=${id}`)[0].state, "active");
      });
    });
    await t.test("export paths and typed snapshot payloads reject invalid input", async () => {
      await rejects(async tx => {
        const [e] = await tx`INSERT INTO document_exports(team_id,space_id,requested_by,format,request_id) VALUES(${project.team_id},${space.id},${actor.id},'pdf',${randomUUID()}) RETURNING id`;
        const [link] = await tx`SELECT node_id FROM document_legacy_links LIMIT 1`;
        await tx`INSERT INTO document_export_items(export_id,node_id,relative_path,kind,snapshot_name,snapshot_url) VALUES(${e.id},${link.node_id},'../escape','link','链接','https://example.test/')`;
      });
    });
    await t.test("export snapshots are immutable and protect exact resources", async () => {
      await rolled(async tx => {
        const [e] = await tx`INSERT INTO document_exports(team_id,space_id,requested_by,format,request_id) VALUES(${project.team_id},${space.id},${actor.id},'pdf',${randomUUID()}) RETURNING id`;
        const [item] = await tx`INSERT INTO document_export_items(export_id,node_id,relative_path,kind,snapshot_name,resource_id) VALUES(${e.id},${legacy.id},'report.pdf','file','报告',${legacy.resource_id}) RETURNING id`;
        await tx`INSERT INTO document_resource_refs(resource_id,export_item_id,role) VALUES(${legacy.resource_id},${item.id},'export')`;
        await assert.rejects(tx.savepoint(inner => inner`UPDATE document_exports SET expires_at=expires_at+interval '1 day' WHERE id=${e.id}`), err => err.code === "23514");
        await assert.rejects(tx.savepoint(inner => inner`UPDATE document_export_items SET snapshot_name='changed' WHERE id=${item.id}`), err => err.code === "23514");
      });
      await rejects(async tx => {
        const [e] = await tx`INSERT INTO document_exports(team_id,space_id,requested_by,format,request_id) VALUES(${project.team_id},${space.id},${actor.id},'pdf',${randomUUID()}) RETURNING id`;
        await tx`INSERT INTO document_export_items(export_id,node_id,relative_path,kind,snapshot_name,resource_id) VALUES(${e.id},${legacy.id},'report.pdf','file','报告',${legacy.resource_id})`;
      });
    });
    await t.test("export count and uncompressed output limits are enforced", async () => {
      for (const tooMany of [true, false]) await rejects(async tx => {
        const [e] = await tx`INSERT INTO document_exports(team_id,space_id,requested_by,format,request_id) VALUES(${project.team_id},${space.id},${actor.id},'pdf',${randomUUID()}) RETURNING id`;
        const [link] = await tx`SELECT node_id FROM document_legacy_links LIMIT 1`;
        await tx`INSERT INTO document_export_items(export_id,node_id,relative_path,kind,snapshot_name,snapshot_url,output_size)
          SELECT ${e.id},${link.node_id},'link-'||g,'link','链接','https://example.test/',${tooMany ? 0 : 524288001} FROM generate_series(1,${tooMany ? 501 : 1}) g`;
      });
    });
    await t.test("image grants require the correct editor and a same-team resource", async () => {
      await rolled(async tx => {
        const id = await doc(tx); const r = await resource(tx); const foreign = await resource(tx, otherProject.team_id);
        await tx`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor.id},${'c'.repeat(64)},clock_timestamp()+interval '1 minute')`;
        await tx`INSERT INTO document_image_grants(node_id,resource_id,user_id,lock_token_hash) VALUES(${id},${r},${actor.id},${'c'.repeat(64)})`;
        await assert.rejects(tx.savepoint(inner => inner`INSERT INTO document_image_grants(node_id,resource_id,user_id,lock_token_hash) VALUES(${id},${foreign},${actor.id},${'c'.repeat(64)})`), err => err.code === "23514");
        await assert.rejects(tx.savepoint(inner => inner`INSERT INTO document_image_grants(node_id,resource_id,user_id,lock_token_hash) VALUES(${id},${r},${actor.id},${'d'.repeat(64)})`), err => err.code === "23514");
      });
    });
    await t.test("expired locks cannot be renewed back to life", async () => {
      await rolled(async tx => {
        const id = await doc(tx);
        await tx`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor.id},${'e'.repeat(64)},clock_timestamp()+interval '50 milliseconds')`;
        await new Promise(resolve => setTimeout(resolve, 100));
        await assert.rejects(tx.savepoint(inner => inner`UPDATE document_edit_locks SET expires_at=clock_timestamp()+interval '1 minute' WHERE node_id=${id}`), err => err.code === "23514");
      });
    });
    await t.test("simultaneous windows cannot both acquire the same document", async () => {
      const id = await sql.begin(tx => doc(tx, `并发验证 ${randomUUID()}`));
      try {
        const attempts = await Promise.allSettled(["a", "b"].map(token => sql.begin(tx => tx`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor.id},${token.repeat(64)},clock_timestamp()+interval '1 minute')`)));
        assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
        assert.equal(attempts.filter(x => x.status === "rejected" && x.reason.code === "23505").length, 1);
      } finally {
        await sql.begin(async tx => { await tx`DELETE FROM document_edit_locks WHERE node_id=${id}`; await tx`DELETE FROM document_nodes WHERE id=${id}`; });
      }
    });
    await t.test("legacy cleanup hands managed binaries to new queue without unlinking", async () => {
      const schema = load("../db/schema.ts");
      await assert.rejects(drizzle(sql).transaction(async db => {
        const [row] = await db.insert(schema.documentResources).values({ teamId: project.team_id,
          storedName: randomUUID(), originalName: "清理样例", size: BigInt(5) }).returning();
        await db.insert(schema.fileCleanup).values({ storedName: row.storedName });
        let unlinks = 0;
        const cleanup = load("../lib/file-cleanup.ts", { "@/db": { db }, "@/db/schema": schema,
          "node:fs/promises": { unlink: async () => { unlinks++; } } });
        await cleanup.drainFileCleanup(1);
        assert.equal(unlinks, 0);
        const jobs = await db.select().from(schema.documentCleanupJobs);
        assert.ok(jobs.some(j => j.resourceId === row.id));
        throw rollback;
      }), e => e === rollback);
    });
    await t.test("failed backfill rolls its writes and migration marker back atomically", async () => {
      await rolled(async tx => {
        await tx`DELETE FROM document_migrations WHERE key='documents-backfill-v1'`;
        await tx`INSERT INTO attachments(project_id,uploader_id,original_name,stored_name,size) VALUES(${project.id},${actor.id},'失败回滚','../invalid',1)`;
        const [before] = await tx`SELECT count(*) AS n FROM document_nodes`;
        const nested = new Proxy(tx, { get(target, key) {
          if (key === "begin") return target.savepoint.bind(target);
          const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
        } });
        await assert.rejects(migrateDocuments(nested, { backfill: true }));
        assert.deepEqual((await tx`SELECT count(*) AS n FROM document_nodes`)[0], before);
        assert.equal((await tx`SELECT key FROM document_migrations WHERE key='documents-backfill-v1'`).length, 0);
      });
    });
    await t.test("fixed migration boundary does not swallow later uploads", async () => {
      await rolled(async tx => {
        const [file] = await tx`INSERT INTO attachments(project_id,uploader_id,original_name,stored_name,size) VALUES(${project.id},${actor.id},'迁移后上传',${randomUUID()},1) RETURNING id`;
        const nested = new Proxy(tx, { get(target, key) { if (key === "begin") return target.savepoint.bind(target); const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } });
        assert.equal((await migrateDocuments(nested, { backfill: true })).backfill.status, "already-applied");
        assert.equal((await tx`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${file.id}`).length, 0);
      });
    });
    await t.test("cutover catches late legacy uploads and is repeatable without moving existing nodes",async()=>{
      await rolled(async tx=>{
        const [file]=await tx`INSERT INTO attachments(project_id,uploader_id,original_name,stored_name,mime_type,size) VALUES(${project.id},${actor.id},'切换前最后附件.txt',${'cutover-'+randomUUID()},'text/plain',10) RETURNING id`;
        assert.equal((await tx`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${file.id}`).length,0);
        const wrapped={begin:fn=>tx.savepoint(fn)};await migrateDocuments(wrapped,{backfill:true,cutover:true});
        const [mapped]=await tx`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${file.id}`;assert.ok(mapped.node_id);
        assert.equal((await tx`SELECT key FROM document_migrations WHERE key='documents-api-cutover-v1'`).length,1);
        await migrateDocuments(wrapped,{backfill:true,cutover:true});assert.equal((await tx`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${file.id}`)[0].node_id,mapped.node_id);
      });
    });
    await t.test("a changed migration checksum fails closed without applying anything", async () => {
      await rolled(async tx => {
        await tx`UPDATE document_migrations SET checksum=${'0'.repeat(64)} WHERE key='documents-schema-v1'`;
        const nested = new Proxy(tx, { get(target, key) { if (key === "begin") return target.savepoint.bind(target); const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } });
        await assert.rejects(migrateDocuments(nested), /DOCUMENT_MIGRATION_CHECKSUM_MISMATCH/);
      });
    });
  } finally { await sql.end(); }
});
