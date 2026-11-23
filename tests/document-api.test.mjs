import {mkdtemp,rm,readdir,readFile,unlink,writeFile} from "node:fs/promises";
import {inflateRawSync} from "node:zlib";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import {createDocumentExportWorker,exportPath} from "../lib/documents/export-worker.ts";
import {createDocumentLifecycle} from "../lib/documents/lifecycle.ts";
import {createDocumentMaintenance} from "../lib/documents/maintenance.ts";
import { createDocumentService } from "../lib/documents/service.ts";
import { createNodeInput, listNodeInput, editorInput } from "../lib/documents/validation.ts";

function zipEntries(bytes){
 const entries=new Map();let offset=bytes.length-22;while(offset>=0&&bytes.readUInt32LE(offset)!==0x06054b50)offset--;assert.ok(offset>=0);const count=bytes.readUInt16LE(offset+10);let cursor=bytes.readUInt32LE(offset+16);
 for(let i=0;i<count;i++){assert.equal(bytes.readUInt32LE(cursor),0x02014b50);const method=bytes.readUInt16LE(cursor+10),compressed=bytes.readUInt32LE(cursor+20),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString();const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);const data=bytes.subarray(start,start+compressed);entries.set(name,method===8?inflateRawSync(data):data);cursor+=46+nameLength+extraLength+commentLength;}return entries;
}
test("document directory service integration (all fixtures rolled back)", {
  skip: process.env.DOCUMENT_API_TEST !== "1" ? "Use node scripts/test-document-api.mjs" : false,
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/agilecampus_test_documents_20261112_v3");
  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const database = drizzle(client);
  const previousUploadDir=process.env.UPLOAD_DIR;const uploadDir=await mkdtemp(path.join(os.tmpdir(),"document-upload-"));process.env.UPLOAD_DIR=uploadDir;
  const rollback = Error("rollback all API fixtures");
  try {
    await assert.rejects(database.transaction(async tx => {
      const service = createDocumentService(tx);
      const query = (q = {}) => listNodeInput(new URLSearchParams(q));
      const denied = (fn, code) => assert.rejects(fn, e => e.code === code);
      const [owner] = await tx.execute(sql`SELECT id FROM users WHERE email='document-migration-owner@example.test'`);
      const [outsider] = await tx.execute(sql`SELECT id FROM users WHERE email='document-migration-outsider@example.test'`);
      const [project] = await tx.execute(sql`SELECT id,team_id FROM projects WHERE key='DMA'`);
      const [archived] = await tx.execute(sql`SELECT id FROM projects WHERE key='DMB'`);
      const [space] = await tx.execute(sql`SELECT id FROM document_spaces WHERE project_id=${project.id}`);
      const [root] = await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id IS NULL AND state='active' ORDER BY id LIMIT 1`);
      const create = (name, parentId = root.id, kind = "folder", extra = {}) => service.create(owner.id, space.id, createNodeInput.parse({ name, parentId, kind, requestId: randomUUID(), ...extra }));
      let folder, document, destination, publicSpace, richDoc;

      await t.test("nonmembers cannot open, list, read or mutate a space", async () => {
        await denied(() => service.openSpace(outsider.id, "project", project.id), "NOT_FOUND");
        await denied(() => service.list(outsider.id, space.id, query()), "NOT_FOUND");
        await denied(() => service.detail(outsider.id, root.id), "NOT_FOUND");
        await denied(() => service.rename(outsider.id, root.id, { name: "越权", expectedVersion: "1" }), "NOT_FOUND");
        await denied(() => service.create(outsider.id, space.id, { name: "越权", kind: "folder", parentId: null, requestId: randomUUID() }), "NOT_FOUND");
      });
      await t.test("new project space initializes exactly three partitions, reopening preserves them", async () => {
        const [p] = await tx.execute(sql`INSERT INTO projects(team_id,name,key) VALUES(${project.team_id},'API 临时项目','API-TEMP') RETURNING id`);
        const opened = await service.openSpace(owner.id, "project", p.id);
        const again = await service.openSpace(owner.id, "project", p.id);
        assert.equal(opened.space.id, again.space.id);
        const page = await service.list(owner.id, opened.space.id, query());
        assert.equal(page.total, 3);
        assert.deepEqual(new Set(page.nodes.map(n => n.name)), new Set(["项目文档", "协作记录", "交付成果"]));
      });
      await t.test("creation persists folders, document body and safe external links", async () => {
        folder = (await create("API-parent")).node;
        destination = (await create("API-destination")).node;
        document = (await create("API-document", folder.id, "document")).node;
        const detail = await service.detail(owner.id, document.id);
        assert.equal(detail.body.type, "doc");
        assert.equal(detail.path.at(-2).id, folder.id);
        const link = (await create("API-link", folder.id, "link", { url: "https://example.test/" })).node;
        assert.equal((await service.detail(owner.id, link.id)).url, "https://example.test/");
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      });
      await t.test("strict inputs reject root documents, unsafe URLs, file spoofing and invalid names", () => {
        for (const value of [
          { kind: "document", parentId: null, name: "正文" },
          { kind: "link", parentId: root.id, name: "链接", url: "javascript:alert(1)" },
          { kind: "link", parentId: root.id, name: "无效网址", url: "invalid" },
          { kind: "file", parentId: root.id, name: "伪造文件", resourceId: 1 },
          { kind: "folder", parentId: null, name: "../越界" },
          { kind: "folder", parentId: null, name: "正常", spaceId: 999 },
        ]) assert.equal(createNodeInput.safeParse({ ...value, requestId: randomUUID() }).success, false);
      });
      await t.test("idempotent create returns same node and rejects changed payload", async () => {
        const input = { kind: "folder", name: "API-idempotent", parentId: root.id, requestId: randomUUID() };
        const first = await service.create(owner.id, space.id, input);
        assert.equal((await service.create(owner.id, space.id, input)).node.id, first.node.id);
        await denied(() => service.create(owner.id, space.id, { ...input, name: "different" }), "REQUEST_CONFLICT");
      });
      await t.test("name conflicts and stale versions are explicit; successful rename increments version", async () => {
        await denied(() => create("api-PARENT"), "NAME_CONFLICT");
        const renamed = await service.rename(owner.id, document.id, { name: "API-renamed", expectedVersion: document.version });
        assert.notEqual(renamed.node.version, document.version);
        await denied(() => service.rename(owner.id, document.id, { name: "stale", expectedVersion: document.version }), "VERSION_CONFLICT");
        document = renamed.node;
      });
      await t.test("title search spans folders and treats SQL wildcard characters literally", async () => {
        await create("API-100%_literal", folder.id, "document");
        const found = await service.list(owner.id, space.id, query({ q: "API-renamed" }));
        assert.deepEqual(found.nodes.map(n => n.id), [document.id]);
        assert.equal((await service.list(owner.id, space.id, query({ q: "%_" }))).total, 1);
      });
      await t.test("folder-first keyset pagination is stable for both sort orders", async () => {
        for (const sort of ["name", "updated"]) {
          const ids = []; let cursor; let folderEnded = false;
          do {
            const page = await service.list(owner.id, space.id, query({ parentId: String(folder.id), limit: "1", sort, ...(cursor ? { cursor } : {}) }));
            for (const n of page.nodes) { if (n.kind !== "folder") folderEnded = true; else assert.equal(folderEnded, false); ids.push(n.id); }
            cursor = page.nextCursor;
          } while (cursor);
          assert.equal(ids.length, new Set(ids).size);
          assert.equal(ids.length, 3);
        }
        await denied(() => service.list(owner.id, space.id, query({ cursor: "invalid" })), "INVALID_CURSOR");
        const page = await service.list(owner.id, space.id, query({ parentId: String(folder.id), limit: "1" }));
        const cursor = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString());
        for (const changed of [{ time: "2026-02-31 12:00:00+00" }, { id: 999999999999 }]) {
          await denied(() => service.list(owner.id, space.id, query({ parentId: String(folder.id), limit: "1", cursor: Buffer.from(JSON.stringify({ ...cursor, ...changed })).toString("base64url") })), "INVALID_CURSOR");
        }
      });
      await t.test("subtree move preserves IDs and descendants, rejects cycles and supports safe retry", async () => {
        await denied(() => service.move(owner.id, folder.id, { targetSpaceId: space.id, targetParentId: folder.id, expectedVersion: folder.version, requestId: randomUUID() }), "DIRECTORY_CYCLE");
        const input = { targetSpaceId: space.id, targetParentId: destination.id, expectedVersion: folder.version, requestId: randomUUID() };
        const moved = await service.move(owner.id, folder.id, input);
        assert.equal(moved.node.parentId, destination.id);
        assert.equal((await service.move(owner.id, folder.id, input)).node.version, moved.node.version);
        assert.equal((await service.detail(owner.id, document.id)).path.at(-3).id, destination.id);
        folder = moved.node;
      });
      await t.test("active edit locks block rename and ancestor moves", async () => {
        await tx.execute(sql`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${document.id},${owner.id},${"a".repeat(64)},clock_timestamp()+interval '1 minute')`);
        const current = (await service.detail(owner.id, document.id)).node;
        assert.equal(current.permissions.rename, false);
        await denied(() => service.rename(owner.id, document.id, { name: "locked", expectedVersion: current.version }), "DOCUMENT_EDITING");
        await denied(() => service.move(owner.id, folder.id, { targetSpaceId: space.id, targetParentId: root.id, expectedVersion: folder.version, requestId: randomUUID() }), "DOCUMENT_EDITING");
        await tx.execute(sql`DELETE FROM document_edit_locks WHERE node_id=${document.id}`);
      });
      await t.test("cross-space move rejects associated descendants", async () => {
        const [task] = await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        await tx.execute(sql`INSERT INTO document_associations(node_id,task_id,created_by) VALUES(${document.id},${task.id},${owner.id})`);
        const target = (await service.openSpace(owner.id, "team", project.team_id)).space;
        await denied(() => service.move(owner.id, folder.id, { targetSpaceId: target.id, targetParentId: null, expectedVersion: folder.version, requestId: randomUUID() }), "REFERENCE_EXISTS");
        assert.equal((await service.detail(owner.id, document.id)).associations.length, 1);
        await tx.execute(sql`DELETE FROM document_associations WHERE node_id=${document.id}`);
      });
      await t.test("same-team public space move preserves subtree; cross-team move is rejected", async () => {
        publicSpace = (await service.openSpace(owner.id, "team", project.team_id)).space;
        const target = (await service.list(owner.id, publicSpace.id, query())).nodes[0];
        const moved = await service.move(owner.id, folder.id, { targetSpaceId: publicSpace.id, targetParentId: target.id, expectedVersion: folder.version, requestId: randomUUID() });
        assert.equal(moved.node.spaceId, publicSpace.id);
        assert.equal((await service.detail(owner.id, document.id)).space.id, publicSpace.id);
        const [other] = await tx.execute(sql`SELECT id FROM teams WHERE owner_id=${outsider.id}`);
        await tx.execute(sql`INSERT INTO team_members(team_id,user_id,role) VALUES(${other.id},${owner.id},'member')`);
        const otherSpace = (await service.openSpace(owner.id, "team", other.id)).space;
        await denied(() => service.move(owner.id, folder.id, { targetSpaceId: otherSpace.id, targetParentId: null, expectedVersion: moved.node.version, requestId: randomUUID() }), "CROSS_TEAM_MOVE");
      });
      await t.test("archived spaces remain readable and reject writes", async () => {
        const archivedSpace = (await service.openSpace(owner.id, "project", archived.id)).space;
        assert.equal(archivedSpace.readOnly, true);
        assert.ok((await service.list(owner.id, archivedSpace.id, query())).nodes.every(n => !n.permissions.write));
        await denied(() => service.create(owner.id, archivedSpace.id, { kind: "folder", name: "拒绝写入", parentId: null, requestId: randomUUID() }), "READ_ONLY_SPACE");
      });
      await t.test("task and milestone associations support atomic add, retry, reverse lookup and removal", async () => {
        const [task] = await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        const [milestone] = await tx.execute(sql`SELECT id FROM milestones WHERE project_id=${project.id} LIMIT 1`);
        for (const [kind, target] of [["task", task], ["milestone", milestone]]) {
          await denied(() => service.associations(outsider.id, kind, target.id), "NOT_FOUND");
          const before = await service.associations(owner.id, kind, target.id);
          const input = { action: "add", nodeIds: [document.id], expectedVersion: before.expectedVersion, requestId: randomUUID() };
          const added = await service.associations(owner.id, kind, target.id, input);
          assert.ok(added.nodes.some(n => n.id === document.id));
          assert.deepEqual((await service.associations(owner.id, kind, target.id, input)).nodes.map(n => n.id), added.nodes.map(n => n.id));
          assert.ok((await service.detail(owner.id, document.id)).associations.some(a => a.type === kind && a.id === target.id));
          await denied(() => service.associations(owner.id, kind, target.id, { ...input, requestId: randomUUID(), expectedVersion: "999999" }), "VERSION_CONFLICT");
          const removed = await service.associations(owner.id, kind, target.id, { ...input, action: "remove", requestId: randomUUID() });
          assert.ok(!removed.nodes.some(n => n.id === document.id));
          assert.equal((await service.detail(owner.id, document.id)).node.id, document.id);
        }
      });
      await t.test("batch associations reject folder and other-project nodes without partial writes", async () => {
        const [task] = await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        const [other] = await tx.execute(sql`INSERT INTO projects(team_id,name,key) VALUES(${project.team_id},'关联范围测试','API-ASSOC') RETURNING id`);
        const otherSpace = (await service.openSpace(owner.id, "project", other.id)).space;
        const otherRoot = (await service.list(owner.id, otherSpace.id, query())).nodes[0];
        const otherDoc = (await service.create(owner.id, otherSpace.id, { kind: "document", name: "另一项目正文", parentId: otherRoot.id, requestId: randomUUID() })).node;
        const before = await service.associations(owner.id, "task", task.id);
        for (const [badId, code] of [[folder.id, "INVALID_TARGET"], [otherDoc.id, "NOT_FOUND"]]) {
          await denied(() => service.associations(owner.id, "task", task.id, { action: "add", nodeIds: [document.id, badId], expectedVersion: before.expectedVersion, requestId: randomUUID() }), code);
          assert.ok(!(await service.associations(owner.id, "task", task.id)).nodes.some(n => n.id === document.id));
        }
      });
      await t.test("ordinary members can associate; archived target blocks add and removal", async () => {
        const [task] = await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        await tx.execute(sql`INSERT INTO team_members(team_id,user_id,role) VALUES(${project.team_id},${outsider.id},'member')`);
        const before = await service.associations(outsider.id, "task", task.id);
        const input = { action: "add", nodeIds: [document.id], expectedVersion: before.expectedVersion, requestId: randomUUID() };
        await service.associations(outsider.id, "task", task.id, input);
        await tx.execute(sql`UPDATE projects SET status='archived' WHERE id=${project.id}`);
        assert.ok((await service.associations(owner.id, "task", task.id)).readOnly);
        for (const action of ["add", "remove"]) await denied(() => service.associations(owner.id, "task", task.id, { ...input, action, requestId: randomUUID() }), "READ_ONLY_SPACE");
        await tx.execute(sql`UPDATE projects SET status='active' WHERE id=${project.id}`);
        const current = await service.associations(owner.id, "task", task.id);
        await service.associations(owner.id, "task", task.id, { ...input, action: "remove", expectedVersion: current.expectedVersion, requestId: randomUUID() });
        await tx.execute(sql`DELETE FROM team_members WHERE team_id=${project.team_id} AND user_id=${outsider.id}`);
        await denied(() => service.associations(outsider.id, "task", task.id), "NOT_FOUND");
      });
      await t.test("editor lock, revision CAS, save retry and release protect document content", async () => {
        const lockToken = "b".repeat(64);
        await denied(() => service.editor(outsider.id, document.id, { action:"acquire",lockToken }), "NOT_FOUND");
        const opened = await service.editor(owner.id, document.id, { action:"acquire",lockToken });
        await denied(() => service.editor(owner.id, document.id, { action:"acquire",lockToken:"c".repeat(64) }), "DOCUMENT_EDITING");
        const content = {type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"正文自动保存验收"}]}]};
        const input = {action:"save",lockToken,expectedBodyRevision:opened.bodyRevision,expectedNodeVersion:opened.nodeVersion,name:opened.name,content,requestId:randomUUID()};
        const result = await service.editor(owner.id, document.id, input);
        assert.notEqual(result.bodyRevision,opened.bodyRevision);
        assert.equal((await service.editor(owner.id, document.id, input)).bodyRevision,result.bodyRevision);
        assert.equal((await service.detail(owner.id, document.id)).body.content[0].content[0].text,"正文自动保存验收");
        await denied(() => service.editor(owner.id,document.id,{...input,requestId:randomUUID()}),"VERSION_CONFLICT");
        await service.editor(owner.id,document.id,{action:"renew",lockToken});
        await service.editor(owner.id,document.id,{action:"release",lockToken:"d".repeat(64)});
        await denied(() => service.editor(owner.id,document.id,{action:"acquire",lockToken:"c".repeat(64)}),"DOCUMENT_EDITING");
        await service.editor(owner.id,document.id,{action:"release",lockToken});
        await denied(() => service.editor(owner.id,document.id,{action:"renew",lockToken}),"LOCK_LOST");
        const reopened = await service.editor(owner.id,document.id,{action:"acquire",lockToken:"c".repeat(64)});
        assert.equal(reopened.bodyRevision,result.bodyRevision);
        const versions=await tx.execute(sql`SELECT id FROM document_versions WHERE node_id=${document.id}`);
        assert.ok(versions.length>=2);
        await service.editor(owner.id,document.id,{action:"release",lockToken:"c".repeat(64)});
        for (const invalid of [
          {type:"doc",content:[{type:"script",text:"alert(1)"}]},
          {type:"doc",content:[{type:"text",text:"危险链接",marks:[{type:"link",attrs:{href:"javascript:alert(1)"}}]}]},
          {type:"doc",attrs:{onclick:"alert(1)"}},
        ]) assert.equal(editorInput.safeParse({...input,content:invalid}).success,false);
        await tx.execute(sql`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${document.id},${owner.id},${"e".repeat(64)},clock_timestamp()+interval '0.1 second')`);
        await new Promise(resolve=>setTimeout(resolve,180));
        await denied(() => service.editor(owner.id,document.id,{action:"renew",lockToken:"e".repeat(64)}),"LOCK_LOST");
        await service.editor(owner.id,document.id,{action:"acquire",lockToken});
        await service.editor(owner.id,document.id,{action:"release",lockToken});

      });
      await t.test("history preview and oldest-version restore preserve title, location, references and recovery point",async()=>{
        const lockToken="f".repeat(64);
        let state=await service.editor(owner.id,document.id,{action:"acquire",lockToken});
        const perform=async(action,extra={})=>{ const input={action,lockToken,expectedBodyRevision:state.bodyRevision,expectedNodeVersion:state.nodeVersion,requestId:randomUUID(),...extra};state=await service.editor(owner.id,document.id,input);return input;};
        for(let i=0;i<11;i++) {
          await perform("save",{name:state.name,content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"历史正文 "+i}]}]}});
          await perform("checkpoint");
        }
        await denied(()=>service.versions(outsider.id,document.id),"NOT_FOUND");
        let history=await service.versions(owner.id,document.id);
        assert.equal(history.versions.length,10);
        const oldest=history.versions.at(-1);
        const preview=await service.versions(owner.id,document.id,oldest.id);
        const before=await service.detail(owner.id,document.id);
        const [task]=await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        const assoc=await service.associations(owner.id,"task",task.id);
        await service.associations(owner.id,"task",task.id,{action:"add",nodeIds:[document.id],expectedVersion:assoc.expectedVersion,requestId:randomUUID()});
        await perform("save",{name:"恢复后仍保留的新标题",content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"恢复前必须保护的当前正文"}]}]}});
        const restore=await perform("restore",{versionId:oldest.id});
        assert.deepEqual(state.content,preview.version.content);
        const restored=await service.detail(owner.id,document.id);
        assert.equal(restored.node.name,"恢复后仍保留的新标题");
        assert.equal(restored.node.parentId,before.node.parentId);
        assert.ok(restored.associations.some(a=>a.type==="task" && a.id===task.id));
        assert.equal((await service.editor(owner.id,document.id,restore)).bodyRevision,state.bodyRevision);
        history=await service.versions(owner.id,document.id);
        assert.equal(history.versions.length,10);
        const protection=await service.versions(owner.id,document.id,history.versions[0].id);
        assert.equal(protection.version.reason,"before_restore");
        assert.ok(JSON.stringify(protection.version.content).includes("恢复前必须保护"));
        await denied(()=>service.editor(owner.id,document.id,{...restore,requestId:randomUUID(),expectedBodyRevision:"1"}),"VERSION_CONFLICT");
        await service.editor(owner.id,document.id,{action:"release",lockToken});
        const currentAssoc=await service.associations(owner.id,"task",task.id);
        await service.associations(owner.id,"task",task.id,{action:"remove",nodeIds:[document.id],expectedVersion:currentAssoc.expectedVersion,requestId:randomUUID()});
      });
      await t.test("file upload persists one resource on retry, enforces scope and cleans failed binaries",async()=>{
        const publicRoot=(await service.list(owner.id,publicSpace.id,query())).nodes[0];
        const input={parentId:publicRoot.id,requestId:randomUUID(),name:"文件上传验收.txt",bytes:new TextEncoder().encode("隔离库上传验收正文")};
        const result=await service.upload(owner.id,publicSpace.id,input);
        const file=await service.file(owner.id,result.node.id);
        assert.equal(file.mimeType,"application/octet-stream");
        assert.equal(file.size,String(input.bytes.length));
        assert.equal((await service.upload(owner.id,publicSpace.id,input)).node.id,result.node.id);
        assert.equal((await readdir(uploadDir)).length,1);
        await denied(()=>service.upload(owner.id,publicSpace.id,{...input,requestId:randomUUID()}),"NAME_CONFLICT");
        assert.equal((await readdir(uploadDir)).length,1);
        await denied(()=>service.file(outsider.id,result.node.id),"NOT_FOUND");
        await denied(()=>service.upload(outsider.id,publicSpace.id,{...input,requestId:randomUUID()}),"NOT_FOUND");
        await denied(()=>service.upload(owner.id,publicSpace.id,{...input,bytes:new Uint8Array(),requestId:randomUUID()}),"INVALID_FILE");
        await denied(()=>service.upload(owner.id,publicSpace.id,{...input,parentId:root.id,requestId:randomUUID()}),"INVALID_TARGET");
        const detail=await service.detail(owner.id,result.node.id);assert.equal(detail.file.preview,false);
        const [task]=await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        const before=await service.associations(owner.id,"task",task.id);
        const linked=await service.associations(owner.id,"task",task.id,{action:"add",nodeIds:[result.node.id],expectedVersion:before.expectedVersion,requestId:randomUUID()});
        assert.ok(linked.nodes.some(n=>n.id===result.node.id));
        await service.associations(owner.id,"task",task.id,{action:"remove",nodeIds:[result.node.id],expectedVersion:before.expectedVersion,requestId:randomUUID()});
      });
      await t.test("copy shares immutable file resources and creates independent document identities",async()=>{
        const fresh=(await service.detail(owner.id,folder.id)).node;
        const input={targetSpaceId:space.id,targetParentId:root.id,expectedVersion:fresh.version,requestId:randomUUID()};
        const copied=await service.copy(owner.id,folder.id,input);
        assert.notEqual(copied.node.id,folder.id);assert.ok(copied.node.name.includes("副本"));
        assert.equal((await service.copy(owner.id,folder.id,input)).node.id,copied.node.id);
        const children=await service.list(owner.id,space.id,query({parentId:String(copied.node.id)}));
        const copyDoc=children.nodes.find(n=>n.kind==="document");assert.ok(copyDoc);
        assert.equal((await service.versions(owner.id,copyDoc.id)).versions.length,0);
        assert.equal((await service.detail(owner.id,copyDoc.id)).associations.length,0);
        const originalFile=(await service.list(owner.id,publicSpace.id,query({q:"文件上传验收.txt"}))).nodes[0];
        const copyFile=await service.copy(owner.id,originalFile.id,{targetSpaceId:space.id,targetParentId:root.id,expectedVersion:originalFile.version,requestId:randomUUID()});
        assert.equal((await service.file(owner.id,copyFile.node.id)).storedName,(await service.file(owner.id,originalFile.id)).storedName);
      });
      await t.test("trash enforces references and locks, restores names and missing-parent destinations, and restricts purge",async()=>{
        const f=(await create("生命周期目录")).node;
        const d=(await create("生命周期正文",f.id,"document")).node;
        const [task]=await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);
        const assoc=await service.associations(owner.id,"task",task.id);
        await service.associations(owner.id,"task",task.id,{action:"add",nodeIds:[d.id],expectedVersion:assoc.expectedVersion,requestId:randomUUID()});
        const trash=()=>service.trash(owner.id,f.id,{expectedVersion:f.version,requestId:randomUUID(),confirmScope:true});
        await denied(trash,"REFERENCE_EXISTS");
        await service.associations(owner.id,"task",task.id,{action:"remove",nodeIds:[d.id],expectedVersion:assoc.expectedVersion,requestId:randomUUID()});
        await service.editor(owner.id,d.id,{action:"acquire",lockToken:"a".repeat(64)});
        await denied(trash,"DOCUMENT_EDITING");
        await service.editor(owner.id,d.id,{action:"release",lockToken:"a".repeat(64)});
        const input={expectedVersion:f.version,requestId:randomUUID(),confirmScope:true};
        const trashed=await service.trash(owner.id,f.id,input);assert.equal(trashed.count,2);
        assert.equal((await service.trash(owner.id,f.id,input)).batchId,trashed.batchId);
        await denied(()=>service.detail(owner.id,d.id),"NOT_FOUND");
        let list=await service.trashList(owner.id,space.id);
        const child=list.nodes.find(n=>n.id===d.id);assert.ok(child);
        const restoredChild=await service.restoreTrash(owner.id,d.id,{expectedVersion:child.version,requestId:randomUUID()});
        assert.equal(restoredChild.recovered,true);assert.ok(restoredChild.path.some(n=>n.name.includes("恢复的资料")));
        await create("生命周期目录");
        list=await service.trashList(owner.id,space.id);const row=list.nodes.find(n=>n.id===f.id);
        const restored=await service.restoreTrash(owner.id,f.id,{expectedVersion:row.version,requestId:randomUUID()});
        assert.ok(restored.node.name.includes("恢复"));assert.equal(restored.count,1);
        await service.trash(owner.id,f.id,{expectedVersion:restored.node.version,requestId:randomUUID(),confirmScope:true});
        list=await service.trashList(owner.id,space.id);const doomed=list.nodes.find(n=>n.id===f.id);
        await tx.execute(sql`INSERT INTO team_members(team_id,user_id,role) VALUES(${project.team_id},${outsider.id},'member')`);
        const purge={expectedVersion:doomed.version,requestId:randomUUID(),confirmPermanent:true};
        await denied(()=>service.purge(outsider.id,f.id,purge),"ADMIN_REQUIRED");
        await service.purge(owner.id,f.id,purge);
        assert.equal((await service.detail(owner.id,d.id)).node.id,d.id);
        await tx.execute(sql`DELETE FROM team_members WHERE team_id=${project.team_id} AND user_id=${outsider.id}`);
      });
      await t.test("reference-aware maintenance retains shared binaries then removes the last unreferenced file",async()=>{
        const original=(await service.list(owner.id,publicSpace.id,query({q:"文件上传验收.txt"}))).nodes[0];
        const copy=(await service.list(owner.id,space.id,query({q:"文件上传验收.txt"}))).nodes[0];
        const [entry]=await tx.execute(sql`SELECT resource_id FROM document_file_entries WHERE node_id=${original.id}`);
        await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${entry.resource_id},clock_timestamp()) ON CONFLICT DO NOTHING`);
        const maintain=createDocumentMaintenance(tx);await maintain(50);
        assert.equal((await readdir(uploadDir)).length,1);
        const remove=async(node,scope)=>{
          await service.trash(owner.id,node.id,{expectedVersion:node.version,requestId:randomUUID(),confirmScope:true});
          const row=(await service.trashList(owner.id,scope)).nodes.find(n=>n.id===node.id);
          const input={expectedVersion:row.version,requestId:randomUUID(),confirmPermanent:true};
          const result=await service.purge(owner.id,node.id,input);
          assert.equal((await service.purge(owner.id,node.id,input)).deleted,result.deleted);
        };
        await remove(copy,space.id);await maintain(50);assert.equal((await readdir(uploadDir)).length,1);
        await remove(original,publicSpace.id);await maintain(50);assert.equal((await readdir(uploadDir)).length,0);
        assert.equal((await tx.execute(sql`SELECT id FROM document_resources WHERE id=${entry.resource_id}`)).length,0);
      });
      await t.test("expired trash cannot restore and maintenance cleans it even in an archived project",async()=>{
        const doc=(await create("到期清理测试",root.id,"document")).node;
        const deletion=await service.trash(owner.id,doc.id,{expectedVersion:doc.version,requestId:randomUUID(),confirmScope:true});
        await tx.execute(sql`UPDATE document_trash_batches SET deleted_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=${deletion.batchId}`);
        await tx.execute(sql`UPDATE document_nodes n SET deleted_at=b.deleted_at,expires_at=b.expires_at FROM document_trash_batches b WHERE b.id=${deletion.batchId} AND n.trash_batch_id=b.id`);
        const row=(await service.trashList(owner.id,space.id)).nodes.find(n=>n.id===doc.id);assert.equal(row.expired,true);
        await denied(()=>service.restoreTrash(owner.id,doc.id,{expectedVersion:row.version,requestId:randomUUID()}),"TRASH_EXPIRED");
        await tx.execute(sql`UPDATE projects SET status='archived' WHERE id=${project.id}`);
        await createDocumentMaintenance(tx)(50);
        assert.equal((await tx.execute(sql`SELECT id FROM document_nodes WHERE id=${doc.id}`)).length,0);
        await tx.execute(sql`UPDATE projects SET status='active' WHERE id=${project.id}`);
      });
      await t.test("templates are optional and recommendation changes do not rewrite existing documents",async()=>{
        const [existing]=await tx.execute(sql`SELECT content_hash FROM document_bodies WHERE node_id=${document.id}`);
        const opened=(await service.openSpace(owner.id,"project",project.id)).space;
        await service.templatePreference(owner.id,opened.id,{templateSet:"software",expectedVersion:opened.version});
        assert.equal((await service.openSpace(owner.id,"project",project.id)).space.templateSet,"software");
        assert.equal((await tx.execute(sql`SELECT content_hash FROM document_bodies WHERE node_id=${document.id}`))[0].content_hash,existing.content_hash);
        const templated=(await service.create(owner.id,space.id,createNodeInput.parse({kind:"document",name:"模板创建验收",parentId:root.id,requestId:randomUUID(),templateKey:"requirements"}))).node;
        assert.ok(JSON.stringify((await service.detail(owner.id,templated.id)).body).includes("功能需求"));
      });
      await t.test("internal images require grants, stay out of directory entries and survive history restoration",async()=>{
        richDoc=(await create("图片正文与导出验收",root.id,"document")).node;
        const lockToken="9".repeat(64);let current=await service.editor(owner.id,richDoc.id,{action:"acquire",lockToken});
        const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
        const input={lockToken,requestId:randomUUID(),name:"内部截图.png",bytes};const image=await service.imageUpload(owner.id,richDoc.id,input);
        assert.equal((await service.imageUpload(owner.id,richDoc.id,input)).resourceId,image.resourceId);
        assert.equal((await tx.execute(sql`SELECT node_id FROM document_file_entries WHERE resource_id=${image.resourceId}`)).length,0);
        await denied(()=>service.image(outsider.id,richDoc.id,image.resourceId),"NOT_FOUND");
        const source=(await service.upload(owner.id,space.id,{parentId:root.id,requestId:randomUUID(),name:"可引用图片.png",bytes})).node;
        const granted=await service.imageGrant(owner.id,richDoc.id,{lockToken,sourceNodeId:source.id});
        const content={type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"正文图片导出与历史验收"}]},{type:"image",attrs:{resourceId:image.resourceId,alt:"内部截图"}},{type:"image",attrs:{resourceId:granted.resourceId,alt:"引用图片"}}]};
        current=await service.editor(owner.id,richDoc.id,{action:"save",lockToken,name:current.name,expectedBodyRevision:current.bodyRevision,expectedNodeVersion:current.nodeVersion,requestId:randomUUID(),content});
        await service.editor(owner.id,richDoc.id,{action:"checkpoint",lockToken,expectedBodyRevision:current.bodyRevision,expectedNodeVersion:current.nodeVersion,requestId:randomUUID()});
        const history=(await service.versions(owner.id,richDoc.id)).versions[0];
        current=await service.editor(owner.id,richDoc.id,{action:"save",lockToken,name:current.name,expectedBodyRevision:current.bodyRevision,expectedNodeVersion:current.nodeVersion,requestId:randomUUID(),content:{type:"doc",content:[{type:"paragraph",content:[]}]}});
        await denied(()=>service.image(owner.id,richDoc.id,image.resourceId,2147483647),"NOT_FOUND");
        assert.equal((await service.image(owner.id,richDoc.id,image.resourceId,history.id)).mimeType,"image/png");
        current=await service.editor(owner.id,richDoc.id,{action:"restore",lockToken,expectedBodyRevision:current.bodyRevision,expectedNodeVersion:current.nodeVersion,requestId:randomUUID(),versionId:history.id});
        assert.equal((await service.image(owner.id,richDoc.id,image.resourceId)).mimeType,"image/png");
        await service.editor(owner.id,richDoc.id,{action:"release",lockToken});
      });
      await t.test("exports freeze content, generate Markdown with images and a real PDF, and recheck access",async()=>{
        const markdown=await service.createExport(owner.id,space.id,{rootId:richDoc.id,format:"markdown",requestId:randomUUID()});
        const pdf=await service.createExport(owner.id,space.id,{rootId:richDoc.id,format:"pdf",requestId:randomUUID()});
        const frozen=(await tx.execute(sql`SELECT snapshot_body FROM document_export_items WHERE export_id=${markdown.exportId}`))[0].snapshot_body;
        await denied(()=>service.exportFile(outsider.id,markdown.exportId),"NOT_FOUND");
        await createDocumentExportWorker(tx)(10);
        const jobs=await service.exports(owner.id,space.id);assert.ok(jobs.exports.some(j=>j.id===markdown.exportId&&j.state==="completed"));assert.ok(jobs.exports.some(j=>j.id===pdf.exportId&&j.state==="completed"));
        const zip=await service.exportFile(owner.id,markdown.exportId);const pdfFile=await service.exportFile(owner.id,pdf.exportId);
        assert.equal((await readFile(exportPath(zip.artifactName))).subarray(0,2).toString(),"PK");
        const entries=zipEntries(await readFile(exportPath(zip.artifactName)));assert.equal([...entries.keys()].filter(n=>n.endsWith(".png")).length,2);const md=[...entries].find(([name])=>name.endsWith(".md"))[1].toString();assert.ok(md.includes("正文图片导出与历史验收"));assert.ok(decodeURI(md).includes("_文档图片/"));

        assert.equal((await readFile(exportPath(pdfFile.artifactName))).subarray(0,5).toString(),"%PDF-");
        assert.deepEqual((await tx.execute(sql`SELECT snapshot_body FROM document_export_items WHERE export_id=${markdown.exportId}`))[0].snapshot_body,frozen);
        const fresh=(await service.detail(owner.id,richDoc.id)).node;
        await service.trash(owner.id,richDoc.id,{expectedVersion:fresh.version,confirmScope:true,requestId:randomUUID()});
        await denied(()=>service.exportFile(owner.id,markdown.exportId),"NOT_FOUND");
      });
      await t.test("ordinary members replace one file atomically without changing copies or associations, and edit links with audit",async()=>{
        await tx.execute(sql`INSERT INTO team_members(team_id,user_id,role) VALUES(${project.team_id},${outsider.id},'member')`);
        const uploaded=await service.upload(owner.id,space.id,{parentId:root.id,name:"原资料标题.txt",bytes:Buffer.from("original content"),requestId:randomUUID()});
        const copy=await service.copy(owner.id,uploaded.node.id,{targetSpaceId:space.id,targetParentId:root.id,expectedVersion:uploaded.node.version,requestId:randomUUID()});
        const [task]=await tx.execute(sql`SELECT id FROM tasks WHERE project_id=${project.id} LIMIT 1`);const refs=await service.associations(owner.id,"task",task.id);await service.associations(owner.id,"task",task.id,{action:"add",nodeIds:[uploaded.node.id],expectedVersion:refs.expectedVersion,requestId:randomUUID()});
        const detail=await service.detail(owner.id,uploaded.node.id);const input={parentId:root.id,name:"新上传文件名.txt",bytes:Buffer.from("replacement content"),requestId:randomUUID(),replace:{nodeId:uploaded.node.id,expectedVersion:detail.node.version,expectedResourceId:detail.file.resourceId,expectedAssociations:1,confirmImpact:true}};
        const result=await service.upload(outsider.id,space.id,input);assert.equal(result.node.id,uploaded.node.id);assert.equal(result.node.name,"原资料标题.txt");assert.equal((await service.upload(outsider.id,space.id,input)).node.id,result.node.id);
        assert.equal((await readFile(path.join(uploadDir,(await service.file(owner.id,copy.node.id)).storedName))).toString(),"original content");assert.equal((await readFile(path.join(uploadDir,(await service.file(owner.id,uploaded.node.id)).storedName))).toString(),"replacement content");
        const after=await service.detail(owner.id,uploaded.node.id);assert.equal(after.associations.length,1);assert.equal(after.operations[0].action,"file.replaced");assert.notEqual(after.file.uploadedBy,after.file.originalUploader);assert.equal((await tx.execute(sql`SELECT uploader_id FROM attachments WHERE id=${uploaded.legacyId}`))[0].uploader_id,owner.id);
        await denied(()=>service.upload(owner.id,space.id,{...input,requestId:randomUUID()}),"VERSION_CONFLICT");
        const link=(await create("可修改链接",root.id,"link",{url:"https://example.test/old"})).node;const update={name:"修改后的链接",url:"https://example.test/new",expectedVersion:link.version,expectedAssociations:0,confirmImpact:true,requestId:randomUUID()};await service.updateLink(outsider.id,link.id,update);const linked=await service.detail(owner.id,link.id);assert.equal(linked.url,update.url);assert.equal(linked.node.id,link.id);assert.equal(linked.operations[0].action,"link.updated");await denied(()=>service.updateLink(owner.id,link.id,{...update,requestId:randomUUID()}),"VERSION_CONFLICT");
        await tx.execute(sql`DELETE FROM team_members WHERE team_id=${project.team_id} AND user_id=${outsider.id}`);
      });
      await t.test("partial exports name failed files, retry the original snapshot and expire without extending access",async()=>{
        const folder=(await create("导出失败恢复")).node;const d=(await create("原快照正文",folder.id,"document")).node;
        const up=await service.upload(owner.id,space.id,{parentId:folder.id,name:"临时缺失.txt",bytes:Buffer.from("recover file bytes"),requestId:randomUUID()});
        const file=await service.file(owner.id,up.node.id);const filePath=path.join(uploadDir,file.storedName);await unlink(filePath);
        const job=await service.createExport(owner.id,space.id,{rootId:folder.id,format:"markdown",requestId:randomUUID()});
        await service.rename(owner.id,d.id,{name:"新标题不影响已截快照",expectedVersion:d.version});
        await createDocumentExportWorker(tx)(10);let [row]=await tx.execute(sql`SELECT state,failure_manifest,snapshot_at,expires_at FROM document_exports WHERE id=${job.exportId}`);assert.equal(row.state,"partial");assert.ok(row.failure_manifest.some(f=>f.path.includes("临时缺失.txt")));
        const partial=await service.exportFile(owner.id,job.exportId);assert.equal(partial.partial,true);const partialZip=zipEntries(await readFile(exportPath(partial.artifactName)));assert.ok([...partialZip.keys()].some(n=>n.includes("失败清单")));assert.ok([...partialZip.keys()].some(n=>n.includes("原快照正文")));assert.ok(![...partialZip.keys()].some(n=>n.includes("新标题")));
        const expiry=row.expires_at;await writeFile(filePath,Buffer.from("recover file bytes"));await service.retryExport(owner.id,job.exportId);await createDocumentExportWorker(tx)(10);[row]=await tx.execute(sql`SELECT state,expires_at FROM document_exports WHERE id=${job.exportId}`);assert.equal(row.state,"completed");assert.deepEqual(row.expires_at,expiry);
        // Advance the transaction clock fixture by creating an already-expired job.
        await tx.execute(sql`INSERT INTO document_exports(space_id,team_id,requested_by,format,request_id,snapshot_at,expires_at) VALUES(${space.id},${project.team_id},${owner.id},'markdown',${randomUUID()},clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour')`);
        const [expired]=await tx.execute(sql`SELECT id FROM document_exports WHERE space_id=${space.id} AND expires_at<clock_timestamp() ORDER BY id DESC LIMIT 1`);await denied(()=>service.exportFile(owner.id,expired.id),"EXPORT_EXPIRED");await createDocumentExportWorker(tx)(1);assert.equal((await tx.execute(sql`SELECT state FROM document_exports WHERE id=${expired.id}`))[0].state,"expired");
      });
      await t.test("cross-space directory moves carry separately trashed descendants and allow restore",async()=>{
        const folder=(await create("带回收站移动")).node;const child=(await create("随目录移动的回收项",folder.id,"document")).node;await service.trash(owner.id,child.id,{expectedVersion:child.version,requestId:randomUUID(),confirmScope:true});
        const moved=await service.move(owner.id,folder.id,{targetSpaceId:publicSpace.id,targetParentId:null,expectedVersion:folder.version,requestId:randomUUID()});const td=await service.detail(owner.id,child.id,true);assert.equal(td.space.id,publicSpace.id);const restored=await service.restoreTrash(owner.id,child.id,{expectedVersion:td.node.version,requestId:randomUUID()});assert.equal(restored.node.parentId,moved.node.id);
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      });
      await t.test("task upload is atomic, preserves a legacy URL identity and rejects wrong-project targets",async()=>{
        const [task]=await tx.execute(sql`INSERT INTO tasks(project_id,title,number) VALUES(${project.id},'上传关联测试',9899) RETURNING id`);
        const uploaded=await service.upload(owner.id,space.id,{parentId:root.id,name:"任务附件.txt",bytes:Buffer.from("atomic attachment"),taskId:task.id,requestId:randomUUID()});
        assert.ok(uploaded.legacyId);assert.ok((await service.associations(owner.id,"task",task.id)).nodes.some(n=>n.id===uploaded.node.id));
        const [bridge]=await tx.execute(sql`SELECT l.node_id,a.stored_name,r.stored_name AS resource_name FROM document_legacy_files l JOIN attachments a ON a.id=l.legacy_attachment_id JOIN document_file_entries f ON f.node_id=l.node_id JOIN document_resources r ON r.id=f.resource_id WHERE l.legacy_attachment_id=${uploaded.legacyId}`);assert.equal(bridge.stored_name,bridge.resource_name);
        await denied(()=>service.upload(owner.id,space.id,{parentId:root.id,name:"不应发布.txt",bytes:Buffer.from("invalid"),taskId:2147483647,requestId:randomUUID()}),"INVALID_TARGET");
        assert.equal((await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND name='不应发布.txt'`)).length,0);
      });
      await t.test("project deletion transfers active/trash identities to public space; team deletion is explicit and queues binaries",async()=>{
        const [team]=await tx.execute(sql`INSERT INTO teams(name,owner_id) VALUES('生命周期测试',${owner.id}) RETURNING id`);
        await tx.execute(sql`INSERT INTO team_members(team_id,user_id,role) VALUES(${team.id},${owner.id},'owner')`);
        const [p]=await tx.execute(sql`INSERT INTO projects(team_id,name,key) VALUES(${team.id},'转存项目','LIFECYCLE') RETURNING id`);
        const life=createDocumentLifecycle(tx);const own=await service.openSpace(owner.id,"project",p.id);const roots=await service.list(owner.id,own.space.id,query());
        const [recovery]=await tx.execute(sql`INSERT INTO document_nodes(space_id,kind,name,normalized_name,system_role) VALUES(${own.space.id},'folder','原项目恢复分区','原项目恢复分区','recovery') RETURNING id`);
        const targetPublic=await service.openSpace(owner.id,"team",team.id);await tx.execute(sql`INSERT INTO document_nodes(space_id,kind,name,normalized_name,system_role) VALUES(${targetPublic.space.id},'folder','公共恢复分区','公共恢复分区','recovery')`);

        const doc=(await service.create(owner.id,own.space.id,createNodeInput.parse({kind:"document",parentId:roots.nodes[0].id,name:"转存正文",requestId:randomUUID()}))).node;
        const file=(await service.upload(owner.id,own.space.id,{parentId:roots.nodes[0].id,name:"转存文件.txt",bytes:Buffer.from("keep after project deletion"),requestId:randomUUID()}));
        const trashed=(await service.create(owner.id,own.space.id,createNodeInput.parse({kind:"document",parentId:roots.nodes[0].id,name:"转存回收站",requestId:randomUUID()}))).node;
        await service.trash(owner.id,trashed.id,{expectedVersion:trashed.version,requestId:randomUUID(),confirmScope:true});
        const impact=await life.impact(owner.id,"project",p.id);
        await denied(()=>life.remove(owner.id,"project",p.id,{confirmPermanent:true,expectedActive:impact.active+1,expectedTrashed:impact.trashed}),"SCOPE_CHANGED");
        const teamImpact=await life.impact(owner.id,"team",team.id);await denied(()=>life.remove(owner.id,"team",team.id,{confirmPermanent:true,expectedActive:teamImpact.active,expectedTrashed:teamImpact.trashed}),"PROJECTS_REMAIN");
        const moved=await life.remove(owner.id,"project",p.id,{confirmPermanent:true,expectedActive:impact.active,expectedTrashed:impact.trashed});assert.ok(moved.destinationNodeId);assert.equal((await tx.execute(sql`SELECT system_role FROM document_nodes WHERE id=${recovery.id}`))[0].system_role,null);
        const after=await service.detail(owner.id,doc.id);assert.equal(after.space.projectId,null);assert.equal(after.path[0].id,moved.destinationNodeId);
        assert.equal((await service.detail(owner.id,trashed.id,true)).trashed,true);
        assert.equal((await tx.execute(sql`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${file.legacyId}`))[0].node_id,file.node.id);
        assert.equal((await tx.execute(sql`SELECT id FROM attachments WHERE id=${file.legacyId}`)).length,0);
        assert.equal((await service.file(owner.id,file.node.id)).name,"转存文件.txt");
        const trashDetail=await service.detail(owner.id,trashed.id,true);await service.restoreTrash(owner.id,trashed.id,{expectedVersion:trashDetail.node.version,requestId:randomUUID()});
        const finalImpact=await life.impact(owner.id,"team",team.id);await life.remove(owner.id,"team",team.id,{confirmPermanent:true,expectedActive:finalImpact.active,expectedTrashed:finalImpact.trashed});
        await denied(()=>service.detail(owner.id,doc.id),"NOT_FOUND");assert.equal((await tx.execute(sql`SELECT id FROM teams WHERE id=${team.id}`)).length,0);
        assert.ok((await tx.execute(sql`SELECT stored_name FROM file_cleanup WHERE stored_name LIKE 'document-%'`)).length);
        await tx.execute(sql`SELECT set_config('app.documents_migrating','off',true),set_config('app.documents_legacy_adapter','off',true)`);
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      });
      await t.test("membership removal immediately revokes previously opened public space", async () => {
        await tx.execute(sql`DELETE FROM team_members WHERE team_id=${project.team_id} AND user_id=${owner.id}`);
        await denied(() => service.list(owner.id, publicSpace.id, query()), "NOT_FOUND");
        await denied(() => service.detail(owner.id, document.id), "NOT_FOUND");
      });
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      throw rollback;
    }), e => e === rollback);
  } finally { await client.end(); if(previousUploadDir===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=previousUploadDir;await rm(uploadDir,{recursive:true,force:true}); }
});
