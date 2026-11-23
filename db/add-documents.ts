import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import postgres, { type Sql, type TransactionSql } from "postgres";

type Tx = TransactionSql;
const schemaKey = "documents-schema-v1";
const backfillKey = "documents-backfill-v1";
const normalize = (s: string) => s.trim().replace(/[A-Z]/g, c => c.toLowerCase());

async function insertFolder(tx: Tx, space: number, role: string, name: string): Promise<number> {
  const [old] = await tx`SELECT node_id FROM document_migration_roots WHERE space_id=${space} AND role=${role}`;
  if (old) {
    if (old.node_id === null) {
      if(role!=="legacy-files")throw new Error("DOCUMENT_MIGRATION_ROOT_REMOVED");
      await tx`DELETE FROM document_migration_roots WHERE space_id=${space} AND role=${role}`;
      return insertFolder(tx,space,role,name);
    }
    return old.node_id;
  }
  let finalName = name;
  for (let seq = 2; (await tx`SELECT 1 FROM document_nodes WHERE space_id=${space} AND parent_id IS NULL AND normalized_name=${normalize(finalName)} AND state='active'`).length; seq++) {
    finalName = `${name}（${seq}）`;
  }
  const [row] = await tx`INSERT INTO document_nodes(space_id,kind,name,normalized_name) VALUES(${space},'folder',${finalName},${normalize(finalName)}) RETURNING id`;
  await tx`INSERT INTO document_migration_roots(space_id,role,node_id) VALUES(${space},${role},${row.id})`;
  return row.id;
}

async function uniqueName(tx: Tx, space: number, parent: number, original: string, id: number): Promise<string> {
  // Preserve the original filename in resource metadata even when its directory label needs sanitizing.
  const cleaned = original.trim().replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180);
  const base = cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : `历史文件 ${id}`;
  let name = base;
  for (let seq = 1; (await tx`SELECT 1 FROM document_nodes WHERE space_id=${space} AND parent_id=${parent} AND normalized_name=${normalize(name)} AND state='active'`).length; seq++) {
    name = `${base}（原附件 ${id}${seq > 1 ? `-${seq}` : ""}）`;
  }
  return name;
}

async function backfill(tx: Tx, catchup=false) {
  const [applied] = await tx`SELECT details FROM document_migrations WHERE key=${backfillKey}`;
  if (applied && !catchup) return { status: "already-applied", details: applied.details };
  // A stable boundary; prevent legacy writes/cascades while the single atomic backfill runs.
  await tx`LOCK TABLE teams,projects,attachments,tasks,milestones,milestone_resources IN SHARE ROW EXCLUSIVE MODE`;
  const [boundary] = await tx`SELECT coalesce((SELECT max(id) FROM attachments),0) AS attachment_id,
    coalesce((SELECT max(id) FROM milestone_resources),0) AS milestone_resource_id`;
  await tx`SELECT set_config('app.documents_migrating','on',true)`;
  const teamRows = await tx`SELECT id FROM teams ORDER BY id`;
  for (const team of teamRows) {
    const [space] = await tx`INSERT INTO document_spaces(team_id) VALUES(${team.id}) ON CONFLICT(team_id) WHERE project_id IS NULL DO UPDATE SET team_id=excluded.team_id RETURNING id`;
    const needsDefaults=!applied || !(await tx`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id IS NULL AND state='active' LIMIT 1`).length;
    for (const [role, name] of [["default-documents", "团队规范"], ["default-records", "共享参考"], ["default-deliverables", "公共素材"]]) {
      if(needsDefaults)await insertFolder(tx, space.id, role, name);
    }
  }
  const projectRows = await tx`SELECT id,team_id,status FROM projects ORDER BY id`;
  let migratedFiles = 0; let migratedLinks = 0;
  for (const project of projectRows) {
    const [space] = await tx`INSERT INTO document_spaces(team_id,project_id,state) VALUES(${project.team_id},${project.id},${project.status === "archived" ? "archived" : "active"}) ON CONFLICT(project_id) DO UPDATE SET project_id=excluded.project_id RETURNING id`;
    if(!applied || !(await tx`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id IS NULL AND state='active' LIMIT 1`).length)for (const [role, name] of [["default-documents", "项目文档"], ["default-records", "协作记录"], ["default-deliverables", "交付成果"]]) await insertFolder(tx, space.id, role, name);
    if(applied && !(await tx`SELECT a.id FROM attachments a LEFT JOIN document_legacy_files l ON l.legacy_attachment_id=a.id WHERE a.project_id=${project.id} AND l.node_id IS NULL LIMIT 1`).length && !(await tx`SELECT r.id FROM milestone_resources r JOIN milestones m ON m.id=r.milestone_id LEFT JOIN document_legacy_links l ON l.legacy_resource_id=r.id WHERE m.project_id=${project.id} AND r.url IS NOT NULL AND l.node_id IS NULL LIMIT 1`).length)continue;
    const historical = await insertFolder(tx, space.id, "legacy-files", "历史文件");
    const files = await tx`SELECT * FROM attachments WHERE project_id=${project.id} AND id<=${boundary.attachment_id} ORDER BY id`;
    for (const file of files) {
      if ((await tx`SELECT 1 FROM document_legacy_files WHERE legacy_attachment_id=${file.id}`).length) continue;
      if (file.task_id && !(await tx`SELECT 1 FROM tasks WHERE id=${file.task_id} AND project_id=${project.id}`).length) throw new Error("DOCUMENT_LEGACY_TASK_SCOPE");
      const [resource] = await tx`INSERT INTO document_resources(team_id,stored_name,original_name,mime_type,size,created_by)
        VALUES(${project.team_id},${file.stored_name},${file.original_name},${file.mime_type},${file.size},${file.uploader_id})
        ON CONFLICT(stored_name) DO UPDATE SET stored_name=excluded.stored_name RETURNING id,team_id,size,mime_type`;
      if (resource.team_id !== project.team_id || String(resource.size) !== String(file.size) || resource.mime_type !== file.mime_type) throw new Error("DOCUMENT_LEGACY_RESOURCE_COLLISION");
      const name = await uniqueName(tx, space.id, historical, file.original_name, file.id);
      const [node] = await tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name,created_by,updated_by)
        VALUES(${space.id},${historical},'file',${name},${normalize(name)},${file.uploader_id},${file.uploader_id}) RETURNING id`;
      await tx`INSERT INTO document_file_entries(node_id,resource_id) VALUES(${node.id},${resource.id})`;
      await tx`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${resource.id},${node.id},'file')`;
      // Copy timestamp without time zone as text in SQL, avoiding JS timezone interpretation.
      await tx`INSERT INTO document_legacy_files(legacy_attachment_id,node_id,legacy_created_at) SELECT id,${node.id},created_at FROM attachments WHERE id=${file.id}`;
      if (file.task_id) await tx`INSERT INTO document_associations(node_id,task_id,created_by) VALUES(${node.id},${file.task_id},${file.uploader_id})`;
      const milestones = await tx`SELECT m.id,r.created_by_id FROM milestone_resources r JOIN milestones m ON m.id=r.milestone_id WHERE r.attachment_id=${file.id}`;
      for (const m of milestones) {
        if (!(await tx`SELECT 1 FROM milestones WHERE id=${m.id} AND project_id=${project.id}`).length) throw new Error("DOCUMENT_LEGACY_MILESTONE_SCOPE");
        await tx`INSERT INTO document_associations(node_id,milestone_id,created_by) VALUES(${node.id},${m.id},${m.created_by_id}) ON CONFLICT DO NOTHING`;
      }
      migratedFiles++;
    }
    const links = await tx`SELECT r.* FROM milestone_resources r JOIN milestones m ON m.id=r.milestone_id WHERE m.project_id=${project.id} AND r.url IS NOT NULL AND r.id<=${boundary.milestone_resource_id} ORDER BY r.id`;
    for (const link of links) {
      if((await tx`SELECT 1 FROM document_legacy_links WHERE legacy_resource_id=${link.id}`).length)continue;
      const url = new URL(link.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("DOCUMENT_LEGACY_LINK_INVALID");
      const name = await uniqueName(tx, space.id, historical, link.title, link.id);
      const [node] = await tx`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name,created_by,updated_by) VALUES(${space.id},${historical},'link',${name},${normalize(name)},${link.created_by_id},${link.created_by_id}) RETURNING id`;
      await tx`INSERT INTO document_link_entries(node_id,url) VALUES(${node.id},${link.url})`;
      await tx`INSERT INTO document_legacy_links(legacy_resource_id,node_id) VALUES(${link.id},${node.id})`;
      await tx`INSERT INTO document_associations(node_id,milestone_id,created_by) VALUES(${node.id},${link.milestone_id},${link.created_by_id})`;
      migratedLinks++;
    }
  }
  const details = { boundary, teams: teamRows.length, projects: projectRows.length, files: migratedFiles, links: migratedLinks, mode: "staged-not-cut-over" };
  const recordKey=applied?`documents-catchup-${boundary.attachment_id}-${boundary.milestone_resource_id}`:backfillKey;
  await tx`INSERT INTO document_migrations(key,checksum,details) VALUES(${recordKey},${createHash("sha256").update(JSON.stringify(details)).digest("hex")},${JSON.stringify(details)}::jsonb) ON CONFLICT DO NOTHING`;
  return { status: "applied", details };
}

export async function migrateDocuments(client: Sql, options: { backfill?: boolean;cutover?:boolean } = {}) {
  const ddl = await readFile(new URL("migrations/001-documents.sql", import.meta.url), "utf8");
  const guards = await readFile(new URL("migrations/002-document-guards.sql", import.meta.url), "utf8");
  const checksum = createHash("sha256").update(ddl).update(guards).digest("hex");
  return client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(177002,1)`;
    await tx`CREATE TABLE IF NOT EXISTS document_migrations(key text PRIMARY KEY,checksum text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,applied_at timestamptz NOT NULL DEFAULT now())`;
    const [old] = await tx`SELECT checksum FROM document_migrations WHERE key=${schemaKey}`;
    if (old && old.checksum !== checksum) throw new Error("DOCUMENT_MIGRATION_CHECKSUM_MISMATCH");
    if (!old) {
      for (const [i, statement] of ddl.split("--> statement-breakpoint").entries()) {
        try {
          await tx.unsafe(statement.replace('CREATE TABLE "document_migrations"', 'CREATE TABLE IF NOT EXISTS "document_migrations"'));
        } catch (cause) { throw new Error(`DOCUMENT_DDL_STATEMENT_${i + 1}`, { cause }); }
      }
      try { await tx.unsafe(guards); } catch (cause) { throw new Error("DOCUMENT_GUARDS_INSTALL_FAILED", { cause }); }
      await tx`INSERT INTO document_migrations(key,checksum) VALUES(${schemaKey},${checksum})`;
    }
    const addition=await readFile(new URL("migrations/003-document-template-preference.sql",import.meta.url),"utf8");
    const additionHash=createHash("sha256").update(addition).digest("hex");
    const [added]=await tx`SELECT checksum FROM document_migrations WHERE key='documents-template-preference-v1'`;
    if(added && added.checksum!==additionHash)throw new Error("DOCUMENT_MIGRATION_CHECKSUM_MISMATCH");
    if(!added){await tx.unsafe(addition);await tx`INSERT INTO document_migrations(key,checksum) VALUES('documents-template-preference-v1',${additionHash})`;}
    const exportAddition=await readFile(new URL("migrations/004-document-export-metadata.sql",import.meta.url),"utf8");
    const exportHash=createHash("sha256").update(exportAddition).digest("hex");
    const [exportOld]=await tx`SELECT checksum FROM document_migrations WHERE key='documents-export-metadata-v1'`;
    if(exportOld&&exportOld.checksum!==exportHash)throw new Error("DOCUMENT_MIGRATION_CHECKSUM_MISMATCH");
    if(!exportOld){await tx.unsafe(exportAddition);await tx`INSERT INTO document_migrations(key,checksum) VALUES('documents-export-metadata-v1',${exportHash})`;}
    const operations=await readFile(new URL("migrations/005-document-operations.sql",import.meta.url),"utf8");const operationsHash=createHash("sha256").update(operations).digest("hex");const [operationsOld]=await tx`SELECT checksum FROM document_migrations WHERE key='documents-operations-v1'`;
    if(operationsOld&&operationsOld.checksum!==operationsHash)throw new Error("DOCUMENT_MIGRATION_CHECKSUM_MISMATCH");
    if(!operationsOld){await tx.unsafe(operations);await tx`INSERT INTO document_migrations(key,checksum) VALUES('documents-operations-v1',${operationsHash})`;}
    const cuttingOver=options.cutover && !(await tx`SELECT key FROM document_migrations WHERE key='documents-api-cutover-v1'`).length;
    const data = options.backfill||cuttingOver ? await backfill(tx,!!cuttingOver) : { status: "not-requested" };
    if(options.cutover){
      if(!(await tx`SELECT key FROM document_migrations WHERE key=${backfillKey}`).length)throw new Error("DOCUMENT_BACKFILL_REQUIRED");
      if((await tx`SELECT a.id FROM attachments a LEFT JOIN document_legacy_files l ON l.legacy_attachment_id=a.id WHERE l.node_id IS NULL LIMIT 1`).length)throw new Error("DOCUMENT_UNMAPPED_LEGACY_FILES");
      await tx`INSERT INTO document_migrations(key,checksum,details) VALUES('documents-api-cutover-v1',${checksum},'{"mode":"canonical-documents"}'::jsonb) ON CONFLICT DO NOTHING`;
    }
    // Force all deferred constraints before reporting success.
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;
    return { schema: old ? "already-applied" : "applied", backfill: data };
  });
}

async function main() {
  config({ path: ".env.local", quiet: true });
  const arg = process.argv.find(a => a.startsWith("--database="));
  const expected = arg?.slice("--database=".length);
  if (!expected || !process.env.DATABASE_URL) throw new Error("EXPLICIT_DATABASE_AND_DATABASE_URL_REQUIRED");
  const url = new URL(process.env.DATABASE_URL);
  if (decodeURIComponent(url.pathname.slice(1)) !== expected) throw new Error("DATABASE_CONFIRMATION_MISMATCH");
  const client = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const [target] = await client`SELECT current_database() AS name`;
    if (target.name !== expected) throw new Error("DATABASE_CONFIRMATION_MISMATCH");
    console.log(JSON.stringify({ database: expected, result: await migrateDocuments(client, { backfill: process.argv.includes("--backfill"),cutover:process.argv.includes("--cutover") }) }));
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Do not print query parameters, URLs or credentials on failed migrations.
    console.error("文档迁移失败，事务已回滚：", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
