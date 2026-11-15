import {templateBody} from "./templates";
import {mkdir,writeFile,unlink} from "node:fs/promises";
import path from "node:path";
import {uploadPath} from "@/lib/file-cleanup";
import {fileType} from "./files";
import {randomUUID} from "node:crypto";
import {documentName} from "./validation";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { DocumentError } from "./errors";
import type { z } from "zod";
import type { editorInput } from "./validation";
import type { CreateNodeInput, RenameNodeInput, MoveNodeInput, ListNodeInput } from "./validation";
import type { DocumentDetail, DocumentKind, DocumentListing, DocumentNode, DocumentPathItem, DocumentSpace } from "./types";

type Database = typeof db;
type Executor = Pick<Database, "execute">;
type SpaceRow = { template_set?:"none"|"general"|"software"; id: number; team_id: number; project_id: number | null; state: string; version: string; project_name: string | null; project_status: string | null; team_name: string; role: string };
type NodeRow = { file_mime_type:string|null;state:string; id: number; space_id: number; parent_id: number | null; kind: DocumentKind; name: string; normalized_name: string; version: string; updated_at: string; updated_by: number | null; author_name: string; child_count: number; folder_count: number; association_count: number; editor_id: number | null; editor_name: string | null; lock_expires: string | null };
const notFound = () => new DocumentError(404, "NOT_FOUND", "资料不存在或无权访问");
const normalize = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
const iso = (s: string) => new Date(s).toISOString();
const spaceDto = (s: SpaceRow): DocumentSpace => ({ templateSet:s.template_set??"none", id: s.id, teamId: s.team_id, projectId: s.project_id, name: s.project_name ?? "团队公共资料", teamName: s.team_name, state: s.state === "archived" || s.project_status === "archived" ? "archived" : "active", version: String(s.version), readOnly: s.state !== "active" || s.project_status === "archived" });
const nodeDto = (n: NodeRow, space: DocumentSpace): DocumentNode => ({ fileMimeType:n.file_mime_type, id: n.id, spaceId: n.space_id, parentId: n.parent_id, kind: n.kind, name: n.name, version: String(n.version), updatedAt: iso(n.updated_at), updatedBy: { id: n.updated_by, name: n.author_name }, childCount: Number(n.child_count), childFolderCount: Number(n.folder_count), associationCount: Number(n.association_count), editLock: n.editor_id ? { editorId: n.editor_id, editorName: n.editor_name ?? "团队成员", expiresAt: iso(n.lock_expires!) } : null, permissions: { read: true, write: !space.readOnly && n.state==="active", rename: !space.readOnly && n.state==="active" && !n.editor_id, move: !space.readOnly && n.state==="active" && !n.editor_id } });

const nodeSelect = sql`SELECT n.state,n.id,n.space_id,n.parent_id,n.kind,n.name,n.normalized_name,n.version::text,n.updated_at::text,n.updated_by,
  coalesce(nullif(u.name,''),u.student_id,'已删除成员') AS author_name,
  (SELECT r.mime_type FROM document_file_entries f JOIN document_resources r ON r.id=f.resource_id WHERE f.node_id=n.id) AS file_mime_type,
  (SELECT count(*)::int FROM document_nodes c WHERE c.parent_id=n.id AND c.state='active') AS child_count,
  (SELECT count(*)::int FROM document_nodes c WHERE c.parent_id=n.id AND c.kind='folder' AND c.state='active') AS folder_count,
  (SELECT count(*)::int FROM document_associations a WHERE a.node_id=n.id) AS association_count,
  l.user_id AS editor_id,coalesce(nullif(editor.name,''),editor.student_id) AS editor_name,l.expires_at::text AS lock_expires
  FROM document_nodes n LEFT JOIN users u ON u.id=n.updated_by
  LEFT JOIN document_edit_locks l ON l.node_id=n.id AND l.expires_at>clock_timestamp()
  LEFT JOIN users editor ON editor.id=l.user_id`;

export function createDocumentService(database: Database = db) {
  async function schemaReady(tx: Executor) {
    const [ready] = await tx.execute<{ ready: boolean }>(sql`SELECT to_regclass('public.document_migrations') IS NOT NULL AS ready`);
    if (!ready.ready) throw new DocumentError(503, "DOCUMENTS_NOT_READY", "文档空间尚未启用，请联系项目维护者");
    const applied = await tx.execute(sql`SELECT key FROM document_migrations WHERE key='documents-schema-v1'`);
    if (!applied.length) throw new DocumentError(503, "DOCUMENTS_NOT_READY", "文档空间尚未启用，请联系项目维护者");
  }

  async function lockSpaces(tx: Executor, actor: number, ids: number[], write: boolean): Promise<SpaceRow[]> {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    const metadata = await tx.execute<{ id: number; team_id: number; project_id: number | null }>(sql`SELECT id,team_id,project_id FROM document_spaces WHERE id IN (${sql.join(unique.map(x => sql`${x}`), sql`,`)}) ORDER BY id`);
    if (metadata.length !== unique.length) throw notFound();
    const teams = [...new Set(metadata.map(s => s.team_id))].sort((a, b) => a - b);
    await tx.execute(sql`SELECT id FROM teams WHERE id IN (${sql.join(teams.map(x => sql`${x}`), sql`,`)}) ORDER BY id FOR SHARE`);
    const projects = metadata.map(s => s.project_id).filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (projects.length) await tx.execute(sql`SELECT id FROM projects WHERE id IN (${sql.join(projects.map(x => sql`${x}`), sql`,`)}) ORDER BY id FOR SHARE`);
    await tx.execute(sql`SELECT id FROM document_spaces WHERE id IN (${sql.join(unique.map(x => sql`${x}`), sql`,`)}) ORDER BY id ${write ? sql`FOR UPDATE` : sql`FOR SHARE`}`);
    const rows = await tx.execute<SpaceRow>(sql`SELECT s.*,s.version::text,t.name AS team_name,p.name AS project_name,p.status AS project_status,m.role
      FROM document_spaces s JOIN teams t ON t.id=s.team_id JOIN team_members m ON m.team_id=s.team_id AND m.user_id=${actor}
      LEFT JOIN projects p ON p.id=s.project_id WHERE s.id IN (${sql.join(unique.map(x => sql`${x}`), sql`,`)}) ORDER BY s.id`);
    if (rows.length !== unique.length || rows.some(s => !["owner", "admin", "member"].includes(s.role))) throw notFound();
    if (rows.some(s => s.state === "deleting")) throw new DocumentError(409, "SPACE_BUSY", "空间正在处理资料，请稍后重试");
    return [...rows];
  }
  function writable(s: SpaceRow) { if (spaceDto(s).readOnly) throw new DocumentError(403, "READ_ONLY_SPACE", "项目已归档，只能阅读；请先恢复项目再修改"); }
  async function trail(tx: Executor, id: number, space: number): Promise<DocumentPathItem[]> {
    const rows = await tx.execute<{ id: number; name: string; parent_id: number | null }>(sql`WITH RECURSIVE chain AS (
      SELECT id,name,parent_id,0 AS depth,ARRAY[id] AS visited FROM document_nodes WHERE id=${id} AND space_id=${space} AND state='active'
      UNION ALL SELECT p.id,p.name,p.parent_id,c.depth+1,c.visited||p.id FROM document_nodes p JOIN chain c ON p.id=c.parent_id
      WHERE p.space_id=${space} AND p.state='active' AND NOT p.id=ANY(c.visited)
    ) SELECT id,name,parent_id FROM chain ORDER BY depth DESC`);
    if (!rows.length || rows[0].parent_id !== null) throw notFound();
    return rows.map(n => ({ id: n.id, name: n.name }));
  }
  async function parent(tx: Executor, id: number | null, space: number) {
    if (id === null) return;
    const [n] = await tx.execute<{ kind: string }>(sql`SELECT kind FROM document_nodes WHERE id=${id} AND space_id=${space} AND state='active'`);
    if (!n || n.kind !== "folder") throw new DocumentError(400, "INVALID_TARGET", "请选择当前空间内的有效文件夹");
    await trail(tx, id, space);
  }
  async function getRow(tx: Executor, id: number, includeTrash=false): Promise<NodeRow> {
    const [row] = await tx.execute<NodeRow>(sql`${nodeSelect} WHERE n.id=${id} AND (n.state='active' ${includeTrash?sql`OR (n.state='trashed' AND n.expires_at>clock_timestamp())`:sql``})`);
    if (!row) throw notFound();
    return row;
  }
  async function unique(tx: Executor, space: number, parentId: number | null, name: string, exclude?: number) {
    const found = await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space} AND parent_id IS NOT DISTINCT FROM ${parentId}::integer
      AND normalized_name=${normalize(name)} AND state='active' ${exclude ? sql`AND id<>${exclude}` : sql``}`);
    if (found.length) throw new DocumentError(409, "NAME_CONFLICT", "当前目录已有同名资料，请更换名称");
  }
  async function idempotent<T>(tx: Executor, actor: number, operation: string, requestId: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await tx.execute(sql`INSERT INTO document_requests(user_id,operation,request_id,payload_hash) VALUES(${actor},${operation},${requestId},${hash}) ON CONFLICT DO NOTHING`);
    const [request] = await tx.execute<{ payload_hash: string; state: string; result_json: T }>(sql`SELECT payload_hash,state,result_json FROM document_requests WHERE user_id=${actor} AND operation=${operation} AND request_id=${requestId} FOR UPDATE`);
    if (request.payload_hash !== hash) throw new DocumentError(409, "REQUEST_CONFLICT", "操作编号已被其他内容使用，请重新发起操作");
    if (request.state === "completed") return request.result_json;
    const result = await run();
    await tx.execute(sql`UPDATE document_requests SET state='completed',result_json=${JSON.stringify(result)}::jsonb WHERE user_id=${actor} AND operation=${operation} AND request_id=${requestId}`);
    return result;
  }

  async function availableName(tx:Executor,space:number,parentId:number|null,name:string,label:string,always=false) {
    const exists=async(value:string)=>(await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space} AND parent_id IS NOT DISTINCT FROM ${parentId}::integer AND state='active' AND normalized_name=${normalize(value)}`)).length>0;
    if(!always && !await exists(name)) return name;
    for(let number=1;number<10000;number++) {const candidate=`${Array.from(name).slice(0,170).join("")}（${label}${number===1?"":number}）`;if(!await exists(candidate))return candidate;}
    throw new DocumentError(409,"NAME_CONFLICT","重名过多，请先整理目标目录");
  }
  async function subtree(tx:Executor,id:number,activeOnly:boolean,batch?:number) {
    return tx.execute<{id:number;parent_id:number|null;kind:DocumentKind;name:string;version:string;depth:number}>(sql`WITH RECURSIVE tree AS (
      SELECT id,parent_id,kind,name,version::text,0 AS depth FROM document_nodes WHERE id=${id}
      UNION ALL SELECT c.id,c.parent_id,c.kind,c.name,c.version::text,t.depth+1 FROM document_nodes c JOIN tree t ON c.parent_id=t.id WHERE true ${activeOnly?sql`AND c.state='active'`:sql``} ${batch?sql`AND c.trash_batch_id=${batch}`:sql``}
    ) SELECT * FROM tree ORDER BY depth,id`);
  }
  async function unlocked(tx:Executor,ids:number[]) {
    if((await tx.execute(sql`SELECT node_id FROM document_edit_locks WHERE node_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,` )}) AND expires_at>clock_timestamp() LIMIT 1`)).length)throw new DocumentError(409,"DOCUMENT_EDITING","目录内有正在编辑的文档，请等待编辑结束");
  }
  async function imageEditor(tx:Executor,actor:number,id:number,lockToken:string) {
    const node=await getRow(tx,id);const [space]=await lockSpaces(tx,actor,[node.space_id],true);writable(space);
    const current=await getRow(tx,id);if(current.space_id!==space.id || current.kind!=="document")throw notFound();
    const hash=createHash("sha256").update(lockToken).digest("hex");
    if(!(await tx.execute(sql`SELECT node_id FROM document_edit_locks WHERE node_id=${id} AND user_id=${actor} AND session_token_hash=${hash} AND expires_at>clock_timestamp()`)).length)throw new DocumentError(409,"LOCK_LOST","编辑锁已失效，请重新进入编辑");
    return {space,hash};
  }
  return {
    async createExport(actor:number,spaceId:number,input:{rootId:number|null;format:"pdf"|"markdown";requestId:string}) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const [space]=await lockSpaces(tx,actor,[spaceId],true);
        return idempotent(tx,actor,"document.export",input.requestId,{spaceId,...input},async()=>{
          let roots:{id:number;name:string;kind:DocumentKind}[];
          if(input.rootId!==null){const node=await getRow(tx,input.rootId);if(node.space_id!==spaceId)throw notFound();await trail(tx,node.id,spaceId);roots=[node];}
          else roots=[...await tx.execute<{id:number;name:string;kind:DocumentKind}>(sql`SELECT id,name,kind FROM document_nodes WHERE space_id=${spaceId} AND parent_id IS NULL AND state='active' ORDER BY id`)];
          const directories:{id:number;path:string}[]=[];const entries:{id:number;kind:DocumentKind;name:string;path:string}[]=[];const used=new Set<string>();
          const clean=(name:string)=>{const result=Array.from(name.replace(/[:*?"<>|]/g,"_").replace(/[. ]+$/g,"")).slice(0,170).join("")||"资料";return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)?"_"+result:result;};
          function allocate(parentPath:string,name:string,nodeId:number,ext=""){let result=parentPath+clean(name)+ext;let number=1;while(used.has(result.toLowerCase())){result=parentPath+clean(name)+`（条目${nodeId}-${number++}）`+ext;}used.add(result.toLowerCase());return result;}
          for(const root of roots){const nodes=await subtree(tx,root.id,true);const paths=new Map<number,string>();for(const node of nodes){const parentPath=paths.get(node.parent_id!)??"";const relative=allocate(parentPath,node.name,node.id,node.kind==="document"?(input.format==="pdf"?".pdf":".md"):node.kind==="link"?".link.txt":"");if(node.kind==="folder"){paths.set(node.id,relative+"/");directories.push({id:node.id,path:relative+"/"});}else entries.push({id:node.id,kind:node.kind,name:node.name,path:relative});}}
          if(entries.length>500)throw new DocumentError(413,"EXPORT_LIMIT","一次最多导出 500 份资料，请缩小目录范围");
          const [job]=await tx.execute<{id:number}>(sql`INSERT INTO document_exports(team_id,space_id,requested_by,format,request_id,snapshot_metadata) VALUES(${space.team_id},${spaceId},${actor},${input.format},${input.requestId},${JSON.stringify({rootId:input.rootId,directPdf:roots.length===1&&roots[0].kind==="document"&&input.format==="pdf",directories})}::jsonb) RETURNING id`);
          let bytes=0;
          for(const entry of entries){
            const [body]=entry.kind==="document"?await tx.execute<{content_json:unknown}>(sql`SELECT content_json FROM document_bodies WHERE node_id=${entry.id}`):[];
            const [file]=entry.kind==="file"?await tx.execute<{resource_id:number;size:string}>(sql`SELECT f.resource_id,r.size::text FROM document_file_entries f JOIN document_resources r ON r.id=f.resource_id WHERE f.node_id=${entry.id} AND r.state='ready'`):[];
            const [link]=entry.kind==="link"?await tx.execute<{url:string}>(sql`SELECT url FROM document_link_entries WHERE node_id=${entry.id}`):[];
            bytes+=file?Number(file.size):body?Buffer.byteLength(JSON.stringify(body.content_json)):Buffer.byteLength(link?.url??"");
            if(bytes>524288000)throw new DocumentError(413,"EXPORT_LIMIT","导出原始内容超过 500MB，请缩小范围");
            const [item]=await tx.execute<{id:number}>(sql`INSERT INTO document_export_items(export_id,node_id,relative_path,kind,snapshot_name,snapshot_body,snapshot_url,resource_id) VALUES(${job.id},${entry.id},${entry.path},${entry.kind},${entry.name},${body?JSON.stringify(body.content_json):null}::jsonb,${link?.url??null},${file?.resource_id??null}) RETURNING id`);
            if(file)await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,export_item_id,role) VALUES(${file.resource_id},${item.id},'export')`);
            if(body)await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,export_item_id,role) SELECT resource_id,${item.id},'export' FROM document_resource_refs WHERE node_id=${entry.id} AND role='body_image'`);
          }
          return {exportId:job.id,state:"queued"};
        });
      });
    },
    async exports(actor:number,spaceId:number,cursor?:number){
      return database.transaction(async tx=>{await schemaReady(tx);await lockSpaces(tx,actor,[spaceId],false);const rows=await tx.execute(sql`SELECT id,CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE state END AS state,format,snapshot_at AS "snapshotAt",expires_at AS "expiresAt",failure_manifest AS "failures",attempts,(SELECT count(*)::int FROM document_export_items i WHERE i.export_id=e.id) AS count FROM document_exports e WHERE space_id=${spaceId} AND requested_by=${actor} ${cursor?sql`AND id<${cursor}`:sql``} ORDER BY id DESC LIMIT 51`);return {exports:[...rows.slice(0,50)],nextCursor:rows.length>50?rows[49].id:null};});
    },
    async retryExport(actor:number,id:number){
      return database.transaction(async tx=>{await schemaReady(tx);const [job]=await tx.execute<{space_id:number}>(sql`SELECT space_id FROM document_exports WHERE id=${id} AND requested_by=${actor}`);if(!job)throw notFound();await lockSpaces(tx,actor,[job.space_id],true);const [current]=await tx.execute<{state:string;expired:boolean}>(sql`SELECT state,expires_at<=clock_timestamp() AS expired FROM document_exports WHERE id=${id} FOR UPDATE`);if(!current||current.expired)throw new DocumentError(410,"EXPORT_EXPIRED","导出已过期，请重新发起");if(!["failed","partial"].includes(current.state))throw new DocumentError(409,"EXPORT_BUSY","任务当前不能重试");await tx.execute(sql`UPDATE document_exports SET state='queued',lease_until=NULL,updated_at=clock_timestamp() WHERE id=${id}`);return {exportId:id,state:"queued"};});
    },
    async exportFile(actor:number,id:number){
      return database.transaction(async tx=>{await schemaReady(tx);const [job]=await tx.execute<{space_id:number;team_id:number;artifact_name:string|null;state:string;snapshot_metadata:{rootId:number|null;directories:{id:number}[]};expired:boolean}>(sql`SELECT *,expires_at<=clock_timestamp() AS expired FROM document_exports WHERE id=${id} AND requested_by=${actor}`);if(!job)throw notFound();
        const items=await tx.execute<{node_id:number;space_id:number|null}>(sql`SELECT i.node_id,n.space_id FROM document_export_items i LEFT JOIN document_nodes n ON n.id=i.node_id WHERE i.export_id=${id}`);
        const directoryIds=(job.snapshot_metadata.directories??[]).map(n=>n.id);if(Number.isInteger(job.snapshot_metadata.rootId))directoryIds.push(job.snapshot_metadata.rootId!);
        const directoryNodes=directoryIds.length?await tx.execute<{id:number;space_id:number}>(sql`SELECT id,space_id FROM document_nodes WHERE id IN (${sql.join(directoryIds.map(n=>sql`${n}`),sql`,`)})`):[];
        const spaces=[job.space_id,...items.map(n=>n.space_id).filter((n):n is number=>n!==null),...directoryNodes.map(n=>n.space_id)];await lockSpaces(tx,actor,spaces,false);
        if(job.expired)throw new DocumentError(410,"EXPORT_EXPIRED","导出已过期，请重新发起");if(!["completed","partial"].includes(job.state)||!job.artifact_name)throw new DocumentError(409,"EXPORT_NOT_READY","导出尚未生成可下载结果");
        for(const nodeId of new Set([...items.map(n=>n.node_id),...directoryIds])){const node=await getRow(tx,nodeId);await trail(tx,nodeId,node.space_id);}
        return {artifactName:job.artifact_name,partial:job.state==="partial"};});
    },
    async imageUpload(actor:number,id:number,input:{lockToken:string;requestId:string;name:string;bytes:Uint8Array}) {
      const mime=fileType(input.bytes);if(!["image/png","image/jpeg","image/webp"].includes(mime)||!input.bytes.length||input.bytes.length>10*1024*1024)throw new DocumentError(400,"INVALID_IMAGE","正文图片仅支持 JPG、PNG、WebP，单张不超过 10MB");
      const storedName=`document-image-${randomUUID()}`;const digest=createHash("sha256").update(input.bytes).digest("hex");
      const staged=await database.transaction(async tx=>{await schemaReady(tx);const {space}=await imageEditor(tx,actor,id,input.lockToken);const [resource]=await tx.execute<{id:number}>(sql`INSERT INTO document_resources(team_id,stored_name,original_name,mime_type,size,state,created_by,staged_for_node_id) VALUES(${space.team_id},${storedName},${input.name.slice(0,200)},${mime},${input.bytes.length},'staged',${actor},${id}) RETURNING id`);await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${resource.id},clock_timestamp()+interval '24 hours')`);return resource.id;});
      async function discard(){await unlink(/* turbopackIgnore: true */ uploadPath(storedName)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=="ENOENT")throw e;});await database.execute(sql`DELETE FROM document_resources WHERE id=${staged}`);}
      try{
        await mkdir(path.dirname(uploadPath(storedName)),{recursive:true});await writeFile(/* turbopackIgnore: true */ uploadPath(storedName),input.bytes,{flag:"wx"});
        const result=await database.transaction(async tx=>{const {hash}=await imageEditor(tx,actor,id,input.lockToken);return idempotent(tx,actor,"document.imageUpload",input.requestId,{id,digest,size:input.bytes.length,lockToken:hash},async()=>{
          await tx.execute(sql`UPDATE document_resources SET state='ready' WHERE id=${staged}`);
          await tx.execute(sql`INSERT INTO document_image_grants(node_id,resource_id,user_id,lock_token_hash) VALUES(${id},${staged},${actor},${hash})`);
          return {resourceId:staged,url:`/api/document-nodes/${id}/images/${staged}`};
        });});
        if(result.resourceId!==staged)await discard();return result;
      }catch(error){const live=await database.execute(sql`SELECT resource_id FROM document_image_grants WHERE resource_id=${staged}`).catch(()=>null);if(live&&!live.length)await discard().catch(()=>{});throw error;}
    },
    async imageGrant(actor:number,id:number,input:{lockToken:string;sourceNodeId?:number;resourceId?:number}) {
      return database.transaction(async tx=>{
        await schemaReady(tx);
        let source:NodeRow|undefined;if(input.sourceNodeId)source=await getRow(tx,input.sourceNodeId);
        const original=await getRow(tx,id);
        const spaces=await lockSpaces(tx,actor,[original.space_id,...source?[source.space_id]:[]],true);
        const target=spaces.find(s=>s.id===original.space_id)!;writable(target);
        if(source){const src=spaces.find(s=>s.id===source!.space_id)!;if(src.team_id!==target.team_id || (src.project_id!==null && src.project_id!==target.project_id))throw new DocumentError(400,"INVALID_IMAGE","只能引用本项目或同团队公共区图片");}
        const {hash,space}=await imageEditor(tx,actor,id,input.lockToken);
        let resource=input.resourceId;
        if(source){if((await getRow(tx,source.id)).space_id!==source.space_id)throw notFound();const [entry]=await tx.execute<{resource_id:number}>(sql`SELECT resource_id FROM document_file_entries WHERE node_id=${source.id}`);resource=entry?.resource_id;}
        if(!resource)throw notFound();
        if(!source && !(await tx.execute(sql`SELECT resource_id FROM document_resource_refs WHERE resource_id=${resource} AND node_id=${id} AND role='body_image' UNION SELECT g.resource_id FROM document_image_grants g WHERE g.node_id=${id} AND g.resource_id=${resource} AND g.user_id=${actor} AND g.expires_at>clock_timestamp() UNION SELECT r.resource_id FROM document_resource_refs r JOIN document_versions v ON v.id=r.version_id WHERE v.node_id=${id} AND r.resource_id=${resource} LIMIT 1`)).length)throw notFound();
        const [file]=await tx.execute(sql`SELECT id FROM document_resources WHERE id=${resource} AND team_id=${space.team_id} AND state='ready' AND size<=10485760 AND mime_type IN ('image/png','image/jpeg','image/webp') FOR UPDATE`);if(!file)throw new DocumentError(400,"INVALID_IMAGE","请选择 JPG、PNG 或 WebP 图片");
        await tx.execute(sql`INSERT INTO document_image_grants(node_id,resource_id,user_id,lock_token_hash) VALUES(${id},${resource},${actor},${hash}) ON CONFLICT(node_id,resource_id,user_id,lock_token_hash) DO UPDATE SET expires_at=clock_timestamp()+interval '24 hours'`);
        return {resourceId:resource,url:`/api/document-nodes/${id}/images/${resource}`};
      });
    },
    async image(actor:number,id:number,resourceId:number,versionId?:number,includeTrash=false) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const initial=await getRow(tx,id,includeTrash);const [space]=await lockSpaces(tx,actor,[initial.space_id],false);const node=await getRow(tx,id,includeTrash);if(node.space_id!==space.id || node.kind!=="document")throw notFound();
        let authorized=false;
        if(versionId)authorized=!!(await tx.execute(sql`SELECT r.id FROM document_resource_refs r JOIN document_versions v ON v.id=r.version_id WHERE v.id=${versionId} AND v.node_id=${id} AND r.resource_id=${resourceId} AND r.role='version_image'`)).length;
        else {authorized=!!(await tx.execute(sql`SELECT id FROM document_resource_refs WHERE node_id=${id} AND resource_id=${resourceId} AND role='body_image'`)).length;
          if(!authorized)authorized=!!(await tx.execute(sql`SELECT g.resource_id FROM document_image_grants g JOIN document_edit_locks l ON l.node_id=g.node_id AND l.user_id=g.user_id AND l.session_token_hash=g.lock_token_hash WHERE g.node_id=${id} AND g.resource_id=${resourceId} AND g.user_id=${actor} AND g.expires_at>clock_timestamp() AND l.expires_at>clock_timestamp()`)).length;
        }
        if(!authorized)throw notFound();
        const [file]=await tx.execute<{storedName:string;mimeType:string;size:string;name:string}>(sql`SELECT stored_name AS "storedName",mime_type AS "mimeType",size::text,original_name AS name FROM document_resources WHERE id=${resourceId} AND team_id=${space.team_id} AND state='ready' AND mime_type IN ('image/png','image/jpeg','image/webp')`);if(!file)throw notFound();return file;
      });
    },
    async templatePreference(actor:number,spaceId:number,input:{templateSet:"none"|"general"|"software";expectedVersion:string}) {
      return database.transaction(async tx=>{await schemaReady(tx);const [space]=await lockSpaces(tx,actor,[spaceId],true);writable(space);if(String(space.version)!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","空间设置已变化，请刷新");await tx.execute(sql`UPDATE document_spaces SET template_set=${input.templateSet},version=version+1 WHERE id=${spaceId}`);return {templateSet:input.templateSet};});
    },
    async copy(actor:number,id:number,input:MoveNodeInput) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const initial=await getRow(tx,id);
        const spaces=await lockSpaces(tx,actor,[initial.space_id,input.targetSpaceId],true);
        const source=spaces.find(s=>s.id===initial.space_id)!;const target=spaces.find(s=>s.id===input.targetSpaceId)!;
        writable(target);if(source.team_id!==target.team_id)throw new DocumentError(400,"CROSS_TEAM_MOVE","不能跨团队复制资料");
        return idempotent(tx,actor,"document.copy",input.requestId,{id,...input},async()=>{
          const node=await getRow(tx,id);if(node.space_id!==source.id || String(node.version)!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","资料已变化，请刷新");
          await parent(tx,input.targetParentId,target.id);await trail(tx,id,source.id);
          const rows=await subtree(tx,id,true);const ids=rows.map(n=>n.id);await unlocked(tx,ids);
          if(input.targetParentId!==null && ids.includes(input.targetParentId))throw new DocumentError(400,"DIRECTORY_CYCLE","不能复制到自身或子目录");
          if(input.targetParentId===null && node.kind!=="folder")throw new DocumentError(400,"INVALID_TARGET","资料必须放在分区或文件夹内");
          const mapping=new Map<number,number>();let root=0;
          for(const n of rows) {
            const parentId=n.id===id?input.targetParentId:mapping.get(n.parent_id!)!;
            const name=n.id===id?await availableName(tx,target.id,parentId,n.name,"副本",true):n.name;
            const [created]=await tx.execute<{id:number}>(sql`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name,created_by,updated_by) VALUES(${target.id},${parentId},${n.kind},${name},${normalize(name)},${actor},${actor}) RETURNING id`);
            mapping.set(n.id,created.id);if(n.id===id)root=created.id;
            if(n.kind==="document")await tx.execute(sql`INSERT INTO document_bodies(node_id,content_json,content_hash,format_version,updated_by) SELECT ${created.id},content_json,content_hash,format_version,${actor} FROM document_bodies WHERE node_id=${n.id}`);
            if(n.kind==="file")await tx.execute(sql`INSERT INTO document_file_entries(node_id,resource_id) SELECT ${created.id},resource_id FROM document_file_entries WHERE node_id=${n.id}`);
            if(n.kind==="link")await tx.execute(sql`INSERT INTO document_link_entries(node_id,url) SELECT ${created.id},url FROM document_link_entries WHERE node_id=${n.id}`);
            await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,node_id,role) SELECT resource_id,${created.id},role FROM document_resource_refs WHERE node_id=${n.id} AND role IN ('body_image','file')`);
          }
          return {node:nodeDto(await getRow(tx,root),spaceDto(target)),count:rows.length,path:await trail(tx,root,target.id)};
        });
      });
    },
    async impact(actor:number,id:number) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const initial=await getRow(tx,id);const [space]=await lockSpaces(tx,actor,[initial.space_id],false);const node=await getRow(tx,id);if(node.space_id!==space.id)throw notFound();await trail(tx,id,space.id);
        const rows=await subtree(tx,id,true);const ids=sql.join(rows.map(n=>sql`${n.id}`),sql`,`);
        const editing=await tx.execute(sql`SELECT n.id,n.name FROM document_edit_locks l JOIN document_nodes n ON n.id=l.node_id WHERE n.id IN (${ids}) AND l.expires_at>clock_timestamp()`);
        const references=await tx.execute(sql`SELECT a.node_id AS "nodeId",n.name,a.task_id AS "taskId",a.milestone_id AS "milestoneId" FROM document_associations a JOIN document_nodes n ON n.id=a.node_id WHERE a.node_id IN (${ids})`);
        return {count:rows.length,folders:rows.filter(n=>n.kind==='folder').length,files:rows.filter(n=>n.kind==='file').length,documents:rows.filter(n=>n.kind==='document').length,links:rows.filter(n=>n.kind==='link').length,editing:[...editing],references:[...references],expectedVersion:String(node.version)};
      });
    },
    async trash(actor:number,id:number,input:{expectedVersion:string;requestId:string;confirmScope:boolean;expectedCount?:number}) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const [initial]=await tx.execute<{space_id:number}>(sql`SELECT space_id FROM document_nodes WHERE id=${id}`);if(!initial)throw notFound();const [space]=await lockSpaces(tx,actor,[initial.space_id],true);writable(space);
        return idempotent(tx,actor,"document.trash",input.requestId,{id,...input},async()=>{
          const node=await getRow(tx,id);if(node.space_id!==space.id || String(node.version)!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","资料已变化，请刷新");
          if(!input.confirmScope)throw new DocumentError(400,"CONFIRM_REQUIRED","请确认删除范围");
          const rows=await subtree(tx,id,true);const ids=rows.map(n=>n.id);if(input.expectedCount!==undefined && input.expectedCount!==rows.length)throw new DocumentError(409,"SCOPE_CHANGED","目录内容数量已变化，请重新核对删除范围");await unlocked(tx,ids);
          const inIds=sql.join(ids.map(n=>sql`${n}`),sql`,`);
          if((await tx.execute(sql`SELECT id FROM document_associations WHERE node_id IN (${inIds}) LIMIT 1`)).length)throw new DocumentError(409,"REFERENCE_EXISTS","存在任务或里程碑关联，请从资料信息中查看并先解除全部关联");
          if(node.parent_id===null && (await tx.execute(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND parent_id IS NULL AND state='active'`)).length<=1)throw new DocumentError(409,"LAST_PARTITION","空间至少保留一个分区");
          const [batch]=await tx.execute<{id:number;expiresAt:string}>(sql`WITH clock AS (SELECT clock_timestamp() AS at) INSERT INTO document_trash_batches(space_id,root_node_id,deleted_by,deleted_at,expires_at) SELECT ${space.id},${id},${actor},at,at+interval '30 days' FROM clock RETURNING id,expires_at::text AS "expiresAt"`);
          for(const n of rows){const originalPath=await trail(tx,n.id,space.id);await tx.execute(sql`INSERT INTO document_trash_items(node_id,batch_id,original_parent_id,original_path,original_space_id,original_name) VALUES(${n.id},${batch.id},${n.parent_id},${JSON.stringify(originalPath)}::jsonb,${space.id},${n.name})`);}
          await tx.execute(sql`UPDATE document_nodes n SET state='trashed',trash_batch_id=b.id,deleted_at=b.deleted_at,expires_at=b.expires_at,version=n.version+1,updated_by=${actor},updated_at=clock_timestamp() FROM document_trash_batches b WHERE b.id=${batch.id} AND n.id IN (${inIds})`);
          return {batchId:batch.id,count:rows.length,expiresAt:batch.expiresAt};
        });
      });
    },
    async trashList(actor:number,spaceId:number,cursor?:number) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const [space]=await lockSpaces(tx,actor,[spaceId],false);
        const rows=await tx.execute(sql`SELECT n.id,n.name,n.kind,n.version::text,n.parent_id AS "parentId",n.trash_batch_id AS "batchId",n.deleted_at AS "deletedAt",n.expires_at AS "expiresAt",n.expires_at<=clock_timestamp() AS expired,coalesce(nullif(deleter.name,''),deleter.student_id,'已删除成员') AS "deletedBy",i.original_path AS "originalPath",(SELECT count(*)::int FROM document_trash_items ti WHERE ti.batch_id=n.trash_batch_id) AS "batchCount" FROM document_nodes n JOIN document_trash_items i ON i.node_id=n.id JOIN document_trash_batches b ON b.id=i.batch_id LEFT JOIN users deleter ON deleter.id=b.deleted_by WHERE n.space_id=${spaceId} AND n.state='trashed' ${cursor?sql`AND n.id<${cursor}`:sql``} ORDER BY n.id DESC LIMIT 51`);
        return {space:spaceDto(space),nodes:[...rows.slice(0,50)],nextCursor:rows.length>50?rows[49].id:null,canPurge:["owner","admin"].includes(space.role)};
      });
    },
    async restoreTrash(actor:number,id:number,input:{expectedVersion:string;requestId:string}) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const [initial]=await tx.execute<{space_id:number}>(sql`SELECT space_id FROM document_nodes WHERE id=${id}`);if(!initial)throw notFound();
        const [space]=await lockSpaces(tx,actor,[initial.space_id],true);writable(space);
        return idempotent(tx,actor,"document.restoreTrash",input.requestId,{id,...input},async()=>{
          const [node]=await tx.execute<{parent_id:number|null;name:string;kind:DocumentKind;version:string;trash_batch_id:number;expired:boolean}>(sql`SELECT parent_id,name,kind,version::text,trash_batch_id,expires_at<=clock_timestamp() AS expired FROM document_nodes WHERE id=${id} AND space_id=${space.id} AND state='trashed'`);
          if(!node)throw notFound();if(node.expired)throw new DocumentError(410,"TRASH_EXPIRED","资料已到期，不能恢复");if(node.version!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","资料已变化，请刷新");
          const rows=await subtree(tx,id,false,node.trash_batch_id);
          let parentId=node.parent_id;let recovered=false;
          if(parentId!==null && !(await tx.execute(sql`SELECT id FROM document_nodes WHERE id=${parentId} AND space_id=${space.id} AND kind='folder' AND state='active'`)).length) {
            let [folder]=await tx.execute<{id:number}>(sql`SELECT id FROM document_nodes WHERE space_id=${space.id} AND state='active' AND system_role='recovery'`);
            if(!folder){const name=await availableName(tx,space.id,null,"恢复的资料","恢复");[folder]=await tx.execute<{id:number}>(sql`INSERT INTO document_nodes(space_id,kind,name,normalized_name,system_role,created_by,updated_by) VALUES(${space.id},'folder',${name},${normalize(name)},'recovery',${actor},${actor}) RETURNING id`);}
            parentId=folder.id;recovered=true;
          }
          const name=await availableName(tx,space.id,parentId,node.name,"恢复");
          const ids=sql.join(rows.map(n=>sql`${n.id}`),sql`,`);
          await tx.execute(sql`DELETE FROM document_trash_items WHERE node_id IN (${ids})`);
          await tx.execute(sql`UPDATE document_nodes SET state='active',trash_batch_id=NULL,deleted_at=NULL,expires_at=NULL,system_role=NULL,parent_id=CASE WHEN id=${id} THEN ${parentId}::integer ELSE parent_id END,name=CASE WHEN id=${id} THEN ${name} ELSE name END,normalized_name=CASE WHEN id=${id} THEN ${normalize(name)} ELSE normalized_name END,version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id IN (${ids})`);
          await tx.execute(sql`DELETE FROM document_trash_batches b WHERE b.id=${node.trash_batch_id} AND NOT EXISTS(SELECT 1 FROM document_trash_items WHERE batch_id=b.id)`);
          return {node:nodeDto(await getRow(tx,id),spaceDto(space)),path:await trail(tx,id,space.id),recovered,count:rows.length};
        });
      });
    },
    async purge(actor:number,id:number,input:{expectedVersion:string;requestId:string;confirmPermanent:boolean},maintenance=false) {
      return database.transaction(async tx=>{
        await schemaReady(tx);let [initial]=await tx.execute<{space_id:number}>(sql`SELECT space_id FROM document_nodes WHERE id=${id}`);
        if(!initial){const [request]=await tx.execute<{result_json:{spaceId:number}}>(sql`SELECT result_json FROM document_requests WHERE user_id=${actor} AND operation='document.purge' AND request_id=${input.requestId} AND state='completed'`);if(request)initial={space_id:request.result_json.spaceId};else throw notFound();}
        const [space]=await lockSpaces(tx,actor,[initial.space_id],true);if(!maintenance)writable(space);if(!["owner","admin"].includes(space.role))throw new DocumentError(403,"ADMIN_REQUIRED","只有负责人和管理员可以永久删除");
        if(!input.confirmPermanent)throw new DocumentError(400,"CONFIRM_REQUIRED","请明确确认永久删除");
        return idempotent(tx,actor,"document.purge",input.requestId,{id,...input},async()=>{
        if(maintenance){if(!(await tx.execute(sql`SELECT id FROM document_nodes WHERE id=${id} AND expires_at<=clock_timestamp() AND state='trashed'`)).length)throw new DocumentError(409,"NOT_EXPIRED","资料尚未到期");await tx.execute(sql`SELECT set_config('app.documents_migrating','on',true)`);}
        const [node]=await tx.execute<{version:string}>(sql`SELECT version::text FROM document_nodes WHERE id=${id} AND state='trashed' AND space_id=${space.id}`);if(!node)throw notFound();if(node.version!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","资料已变化，请刷新");
        const rows=await subtree(tx,id,false);const ids=sql.join(rows.map(n=>sql`${n.id}`),sql`,`);await unlocked(tx,rows.map(n=>n.id));
        const resources=await tx.execute<{resource_id:number}>(sql`SELECT DISTINCT r.resource_id FROM document_resource_refs r LEFT JOIN document_versions v ON v.id=r.version_id WHERE r.node_id IN (${ids}) OR v.node_id IN (${ids})`);
        await tx.execute(sql`SELECT set_config('app.documents_legacy_adapter','on',true)`);
        await tx.execute(sql`DELETE FROM attachments WHERE id IN (SELECT legacy_attachment_id FROM document_legacy_files WHERE node_id IN (${ids}))`);
        await tx.execute(sql`DELETE FROM milestone_resources WHERE id IN (SELECT legacy_resource_id FROM document_legacy_links WHERE node_id IN (${ids}))`);
        // RESTRICT parent FKs require deleting descendants before their parent.
        for(const n of [...rows].reverse())await tx.execute(sql`DELETE FROM document_nodes WHERE id=${n.id}`);
        await tx.execute(sql`DELETE FROM document_trash_batches b WHERE b.space_id=${space.id} AND NOT EXISTS(SELECT 1 FROM document_trash_items WHERE batch_id=b.id)`);
        for(const r of resources)await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${r.resource_id},clock_timestamp()) ON CONFLICT(resource_id) DO UPDATE SET not_before=least(document_cleanup_jobs.not_before,EXCLUDED.not_before)`);
        return {spaceId:space.id,deleted:rows.length,cleanupQueued:true};
        });
      });
    },
    async upload(actor:number,spaceId:number,input:{parentId:number;requestId:string;name:string;bytes:Uint8Array;taskId?:number;milestoneId?:number;replace?:{nodeId:number;expectedVersion:string;expectedResourceId:number;confirmImpact:true;expectedAssociations:number}}) {
      const name=documentName.parse(input.name);
      if(!input.bytes.length || input.bytes.length>100*1024*1024) throw new DocumentError(input.bytes.length?413:400,"INVALID_FILE","请选择非空且不超过 100MB 的文件");
      const storedName=`document-${randomUUID()}${path.extname(name).replace(/[^a-zA-Z0-9.]/g,"").slice(0,10)}`;
      const mime=fileType(input.bytes); const digest=createHash("sha256").update(input.bytes).digest("hex");
      const staged=await database.transaction(async tx=>{
        await schemaReady(tx);const [space]=await lockSpaces(tx,actor,[spaceId],true);writable(space);
        await parent(tx,input.parentId,spaceId);
        const [resource]=await tx.execute<{id:number}>(sql`INSERT INTO document_resources(team_id,stored_name,original_name,mime_type,size,state,created_by) VALUES(${space.team_id},${storedName},${name},${mime},${input.bytes.length},'staged',${actor}) RETURNING id`);
        await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${resource.id},clock_timestamp()+interval '24 hours')`);
        return resource.id;
      });
      async function cleanup() {
        try {await unlink(/* turbopackIgnore: true */ uploadPath(storedName));}catch(error){if((error as {code?:string}).code!=="ENOENT") return;}
        await database.transaction(async tx=>{await tx.execute(sql`DELETE FROM document_cleanup_jobs WHERE resource_id=${staged}`);await tx.execute(sql`DELETE FROM document_resources WHERE id=${staged} AND state='staged'`);});
      }
      let published=false;
      try {
        await mkdir(path.dirname(uploadPath(storedName)),{recursive:true});
        await writeFile(/* turbopackIgnore: true */ uploadPath(storedName),input.bytes,{flag:"wx"});
        const result=await database.transaction(async tx=>{
          const [space]=await lockSpaces(tx,actor,[spaceId],true);writable(space);
          return idempotent(tx,actor,"document.upload",input.requestId,{spaceId,parentId:input.parentId,name,digest,size:input.bytes.length,taskId:input.taskId??null,milestoneId:input.milestoneId??null,replace:input.replace??null},async()=>{
            if(input.replace){
              const replacement=input.replace;const node=await getRow(tx,replacement.nodeId);
              if(node.space_id!==spaceId||node.kind!=="file"||node.parent_id!==input.parentId)throw notFound();
              if(String(node.version)!==replacement.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","资料已变化，请重新核对替换影响");
              const [old]=await tx.execute<{resource_id:number}>(sql`SELECT resource_id FROM document_file_entries WHERE node_id=${node.id}`);
              const [associations]=await tx.execute<{count:number}>(sql`SELECT count(*)::int AS count FROM document_associations WHERE node_id=${node.id}`);
              if(!replacement.confirmImpact||old.resource_id!==replacement.expectedResourceId||associations.count!==replacement.expectedAssociations)throw new DocumentError(409,"SCOPE_CHANGED","文件或关联范围已变化，请重新核对");
              await tx.execute(sql`UPDATE document_resources SET state='ready' WHERE id=${staged}`);
              await tx.execute(sql`DELETE FROM document_resource_refs WHERE node_id=${node.id} AND role='file'`);
              await tx.execute(sql`UPDATE document_file_entries SET resource_id=${staged} WHERE node_id=${node.id}`);
              await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${staged},${node.id},'file')`);
              await tx.execute(sql`UPDATE document_nodes SET version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id=${node.id}`);
              await tx.execute(sql`SELECT set_config('app.documents_legacy_adapter','on',true)`);
              await tx.execute(sql`UPDATE attachments SET stored_name=${storedName},mime_type=${mime},size=${input.bytes.length} WHERE id IN (SELECT legacy_attachment_id FROM document_legacy_files WHERE node_id=${node.id})`);
              await tx.execute(sql`INSERT INTO document_operations(node_id,actor_id,action,detail) VALUES(${node.id},${actor},'file.replaced',${JSON.stringify({previousResourceId:old.resource_id,resourceId:staged,uploadedName:name})}::jsonb)`);
              await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${old.resource_id},clock_timestamp()) ON CONFLICT DO NOTHING`);
              await tx.execute(sql`DELETE FROM document_cleanup_jobs WHERE resource_id=${staged}`);
              return {legacyId:undefined,node:nodeDto(await getRow(tx,node.id),spaceDto(space))};
            }
            await parent(tx,input.parentId,spaceId);await unique(tx,spaceId,input.parentId,name);
            for(const [kind,target] of [["task",input.taskId],["milestone",input.milestoneId]] as const){if(!target)continue;if(!space.project_id || !(await tx.execute(kind==="task"?sql`SELECT id FROM tasks WHERE id=${target} AND project_id=${space.project_id}`:sql`SELECT id FROM milestones WHERE id=${target} AND project_id=${space.project_id}`)).length)throw new DocumentError(400,"INVALID_TARGET","上传关联对象必须属于当前项目");}

            const [node]=await tx.execute<{id:number}>(sql`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name,created_by,updated_by) VALUES(${spaceId},${input.parentId},'file',${name},${normalize(name)},${actor},${actor}) RETURNING id`);
            await tx.execute(sql`UPDATE document_resources SET state='ready' WHERE id=${staged}`);
            await tx.execute(sql`INSERT INTO document_file_entries(node_id,resource_id) VALUES(${node.id},${staged})`);
            await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${staged},${node.id},'file')`);
            await tx.execute(sql`DELETE FROM document_cleanup_jobs WHERE resource_id=${staged}`);
            let legacyId:number|undefined;
            if(space.project_id){const [legacy]=await tx.execute<{id:number}>(sql`INSERT INTO attachments(project_id,task_id,uploader_id,original_name,stored_name,mime_type,size) VALUES(${space.project_id},${input.taskId??null},${actor},${name},${storedName},${mime},${input.bytes.length}) RETURNING id`);legacyId=legacy.id;await tx.execute(sql`INSERT INTO document_legacy_files(legacy_attachment_id,node_id,legacy_created_at) SELECT id,${node.id},created_at FROM attachments WHERE id=${legacy.id}`);}
            if(input.taskId)await tx.execute(sql`INSERT INTO document_associations(node_id,task_id,created_by) VALUES(${node.id},${input.taskId},${actor})`);
            if(input.milestoneId)await tx.execute(sql`INSERT INTO document_associations(node_id,milestone_id,created_by) VALUES(${node.id},${input.milestoneId},${actor})`);
            return {legacyId,node:nodeDto(await getRow(tx,node.id),spaceDto(space))};
          });
        });
        const used=await database.execute(sql`SELECT node_id FROM document_file_entries WHERE resource_id=${staged}`);
        published=!!used.length;
        if(!published) await cleanup();
        return result;
      }catch(error){
        // If the commit acknowledgement was lost, never unlink a referenced binary.
        const used=await database.execute(sql`SELECT node_id FROM document_file_entries WHERE resource_id=${staged}`).catch(()=>null);
        if(used && !used.length && !published) await cleanup().catch(()=>{});
        throw error;
      }
    },
    async file(actor:number,id:number,includeTrash=false) {
      return database.transaction(async tx=>{
        await schemaReady(tx);const initial=await getRow(tx,id,includeTrash);
        const [space]=await lockSpaces(tx,actor,[initial.space_id],false);const node=await getRow(tx,id,includeTrash);
        if(node.space_id!==space.id || node.kind!=="file") throw notFound();
        if(node.state==="active")await trail(tx,id,space.id);
        const [file]=await tx.execute<{storedName:string;mimeType:string;size:string}>(sql`SELECT r.stored_name AS "storedName",r.mime_type AS "mimeType",r.size::text FROM document_file_entries f JOIN document_resources r ON r.id=f.resource_id WHERE f.node_id=${id} AND r.team_id=${space.team_id} AND r.state='ready'`);
        if(!file) throw notFound();
        return {...file,name:node.name};
      });
    },

    async versions(actor: number, id: number, versionId?: number) {
      return database.transaction(async tx => {
        await schemaReady(tx);
        const initial=await getRow(tx,id);
        const [space]=await lockSpaces(tx,actor,[initial.space_id],false);
        const node=await getRow(tx,id);
        if(node.space_id!==space.id) throw new DocumentError(409,"VERSION_CONFLICT","资料已移动，请刷新");
        if(node.kind!=="document") throw notFound();
        await trail(tx,id,space.id);
        const rows=await tx.execute(sql`SELECT id,source_revision::text AS "sourceRevision",body_author_name AS "authorName",reason,created_at AS "createdAt",content_hash AS "contentHash" ${versionId ? sql`,content_json AS content` : sql``} FROM document_versions WHERE node_id=${id} ${versionId ? sql`AND id=${versionId}` : sql``} ORDER BY id DESC LIMIT 10`);
        if(versionId && !rows.length) throw notFound();
        return versionId ? {version:rows[0]} : {versions:[...rows],readOnly:spaceDto(space).readOnly};
      });
    },

    async editor(actor: number, id: number, input: z.infer<typeof editorInput>) {
      return database.transaction(async tx => {
        await schemaReady(tx);
        const initial = await getRow(tx, id);
        const [space] = await lockSpaces(tx, actor, [initial.space_id], true);
        const node = await getRow(tx, id);
        if (node.space_id !== space.id) throw new DocumentError(409, "VERSION_CONFLICT", "资料已移动，请刷新");
        if (node.kind !== "document") throw new DocumentError(400, "INVALID_TARGET", "只有在线文档支持正文编辑");
        await trail(tx, id, space.id);
        const hash = createHash("sha256").update(input.lockToken).digest("hex");
        if (input.action === "release") {
          await tx.execute(sql`DELETE FROM document_edit_locks WHERE node_id=${id} AND user_id=${actor} AND session_token_hash=${hash}`);
          return { released: true };
        }
        writable(space);
        await tx.execute(sql`DELETE FROM document_edit_locks WHERE node_id=${id} AND expires_at<=clock_timestamp()`);
        const read = async () => {
          const [body] = await tx.execute<{ content: unknown; bodyRevision: string; contentHash: string }>(sql`SELECT content_json AS content,body_revision::text AS "bodyRevision",content_hash AS "contentHash" FROM document_bodies WHERE node_id=${id}`);
          const [lock] = await tx.execute<{ expiresAt: string }>(sql`SELECT expires_at::text AS "expiresAt" FROM document_edit_locks WHERE node_id=${id}`);
          const fresh = await getRow(tx,id);
          return { ...body, nodeVersion: String(fresh.version), name: fresh.name, expiresAt: lock?.expiresAt, savedAt: iso(fresh.updated_at) };
        };
        const checkpoint = async (reason: string) => {
          const [last] = await tx.execute<{ content_hash: string }>(sql`SELECT content_hash FROM document_versions WHERE node_id=${id} ORDER BY id DESC LIMIT 1`);
          const [body] = await tx.execute<{ content_hash: string }>(sql`SELECT content_hash FROM document_bodies WHERE node_id=${id}`);
          if (last?.content_hash !== body.content_hash) {
            const [v] = await tx.execute<{ id: number }>(sql`INSERT INTO document_versions(node_id,content_json,content_hash,source_revision,body_author_id,body_author_name,created_by,reason) SELECT b.node_id,b.content_json,b.content_hash,b.body_revision,b.updated_by,coalesce(u.name,u.student_id,'团队成员'),${actor},${reason} FROM document_bodies b LEFT JOIN users u ON u.id=b.updated_by WHERE b.node_id=${id} RETURNING id`);
            await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,version_id,role) SELECT resource_id,${v.id},'version_image' FROM document_resource_refs WHERE node_id=${id} AND role='body_image'`);
            await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) SELECT DISTINCT r.resource_id,clock_timestamp() FROM document_resource_refs r JOIN document_versions v ON v.id=r.version_id WHERE v.node_id=${id} AND v.id NOT IN (SELECT id FROM document_versions WHERE node_id=${id} ORDER BY id DESC LIMIT 10) ON CONFLICT DO NOTHING`);
            await tx.execute(sql`DELETE FROM document_versions WHERE node_id=${id} AND id NOT IN (SELECT id FROM document_versions WHERE node_id=${id} ORDER BY id DESC LIMIT 10)`);
          }
          await tx.execute(sql`UPDATE document_bodies SET last_checkpoint_at=clock_timestamp() WHERE node_id=${id}`);
        };
        if (input.action === "acquire") {
          const [lock] = await tx.execute<{ session_token_hash: string; user_id: number }>(sql`SELECT session_token_hash,user_id FROM document_edit_locks WHERE node_id=${id}`);
          if (lock && (lock.session_token_hash !== hash || lock.user_id !== actor)) throw new DocumentError(409,"DOCUMENT_EDITING","文档正被其他窗口编辑，请稍后重试");
          if (!lock) {
            await tx.execute(sql`INSERT INTO document_edit_locks(node_id,user_id,session_token_hash,expires_at) VALUES(${id},${actor},${hash},clock_timestamp()+interval '119 seconds')`);
            await checkpoint("edit_start");
          }
          return read();
        }
        const [valid] = await tx.execute(sql`SELECT node_id FROM document_edit_locks WHERE node_id=${id} AND user_id=${actor} AND session_token_hash=${hash} AND expires_at>clock_timestamp()`);
        if (!valid) throw new DocumentError(409,"LOCK_LOST","编辑锁已失效，已停止写入，请保留草稿并重新进入编辑");
        if (input.action === "renew") {
          await tx.execute(sql`UPDATE document_edit_locks SET expires_at=clock_timestamp()+interval '119 seconds' WHERE node_id=${id}`);
          const due = await tx.execute(sql`SELECT node_id FROM document_bodies WHERE node_id=${id} AND last_checkpoint_at<clock_timestamp()-interval '10 minutes'`);
          if (due.length) await checkpoint("periodic");
          return read();
        }
        if(input.action === "checkpoint" || input.action === "restore") {
          return idempotent(tx,actor,`document.${input.action}`,input.requestId,{id,...input,lockToken:hash},async()=>{
            const [body]=await tx.execute<{revision:string}>(sql`SELECT body_revision::text AS revision FROM document_bodies WHERE node_id=${id}`);
            if(body.revision!==input.expectedBodyRevision || String(node.version)!==input.expectedNodeVersion) throw new DocumentError(409,"VERSION_CONFLICT","服务器内容已变化，请刷新后重试");
            if(input.action === "checkpoint") { await checkpoint("manual"); return read(); }
            const [version]=await tx.execute<{content_json:unknown;content_hash:string;format_version:number}>(sql`SELECT content_json,content_hash,format_version FROM document_versions WHERE id=${input.versionId} AND node_id=${id}`);
            if(!version) throw notFound();
            const images=await tx.execute<{resource_id:number}>(sql`SELECT resource_id FROM document_resource_refs WHERE version_id=${input.versionId} AND role='version_image' ORDER BY resource_id`);
            // Capture the selected snapshot and image IDs before protecting current content:
            // trimming to ten versions may remove the selected oldest snapshot.
            await checkpoint("before_restore");
            await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) SELECT resource_id,clock_timestamp() FROM document_resource_refs WHERE node_id=${id} AND role='body_image' ON CONFLICT DO NOTHING`);
            await tx.execute(sql`DELETE FROM document_resource_refs WHERE node_id=${id} AND role='body_image'`);
            for(const image of images) await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${image.resource_id},${id},'body_image')`);
            await tx.execute(sql`UPDATE document_bodies SET content_json=${JSON.stringify(version.content_json)}::jsonb,content_hash=${version.content_hash},format_version=${version.format_version},body_revision=body_revision+1,updated_by=${actor},updated_at=clock_timestamp() WHERE node_id=${id}`);
            await tx.execute(sql`UPDATE document_nodes SET version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id=${id}`);
            return read();
          });
        }
        return idempotent(tx, actor, "document.save", input.requestId, {id,...input,lockToken:hash}, async () => {
          const [body] = await tx.execute<{ revision: string; content_hash: string }>(sql`SELECT body_revision::text AS revision,content_hash FROM document_bodies WHERE node_id=${id}`);
          if (body.revision !== input.expectedBodyRevision || String(node.version) !== input.expectedNodeVersion) throw new DocumentError(409,"VERSION_CONFLICT","服务器内容已变化，草稿已保留，请重新读取后比较");
          await unique(tx,space.id,node.parent_id,input.name,id);
          const images: number[] = []; const newImages:number[]=[];
          function collect(n: {type:string;attrs?:Record<string,unknown>;content?:unknown[]}) { if(n.type==='image') images.push(Number(n.attrs?.resourceId)); for(const c of n.content??[]) collect(c as typeof n); }
          collect(input.content);
          for (const resource of new Set(images)) {
            if (!(await tx.execute(sql`SELECT id FROM document_resource_refs WHERE node_id=${id} AND resource_id=${resource} AND role='body_image'`)).length) {
              if(!(await tx.execute(sql`SELECT resource_id FROM document_image_grants WHERE node_id=${id} AND resource_id=${resource} AND user_id=${actor} AND lock_token_hash=${hash} AND expires_at>clock_timestamp()`)).length)throw new DocumentError(400,"INVALID_IMAGE","图片尚未通过当前文档授权，请重新选择图片");
              newImages.push(resource);
            }
          }
          const json = JSON.stringify(input.content); const digest = createHash("sha256").update(json).digest("hex");
          if (digest !== body.content_hash) {
            const due = await tx.execute(sql`SELECT node_id FROM document_bodies WHERE node_id=${id} AND last_checkpoint_at<clock_timestamp()-interval '10 minutes'`);
            if(due.length) await checkpoint("periodic");
            await tx.execute(sql`UPDATE document_bodies SET content_json=${json}::jsonb,content_hash=${digest},body_revision=body_revision+1,updated_by=${actor},updated_at=clock_timestamp() WHERE node_id=${id}`);
            for(const resource of newImages)await tx.execute(sql`INSERT INTO document_resource_refs(resource_id,node_id,role) VALUES(${resource},${id},'body_image') ON CONFLICT DO NOTHING`);
            const refs = await tx.execute<{id:number;resource_id:number}>(sql`SELECT id,resource_id FROM document_resource_refs WHERE node_id=${id} AND role='body_image'`);
            for(const ref of refs) if(!images.includes(ref.resource_id)) {await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) VALUES(${ref.resource_id},clock_timestamp()) ON CONFLICT DO NOTHING`);await tx.execute(sql`DELETE FROM document_resource_refs WHERE id=${ref.id}`);}
          }
          await tx.execute(sql`SELECT set_config('app.document_lock_token_hash',${hash},true)`);
          if (digest !== body.content_hash || node.name !== input.name) await tx.execute(sql`UPDATE document_nodes SET name=${input.name},normalized_name=${normalize(input.name)},version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id=${id}`);
          return read();
        });
      });
    },

    async associations(actor: number, kind: "task" | "milestone", targetId: number, input?: { action: "add" | "remove"; nodeIds: number[]; expectedVersion: string; requestId: string }) {
      return database.transaction(async tx => {
        await schemaReady(tx);
        const table = kind === "task" ? sql`tasks` : sql`milestones`;
        const column = kind === "task" ? sql`task_id` : sql`milestone_id`;
        const [target] = await tx.execute<{ project_id: number; team_id: number }>(sql`SELECT t.project_id,p.team_id FROM ${table} t JOIN projects p ON p.id=t.project_id JOIN team_members m ON m.team_id=p.team_id AND m.user_id=${actor} WHERE t.id=${targetId}`);
        if (!target) throw notFound();
        await tx.execute(sql`SELECT id FROM teams WHERE id=${target.team_id} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM projects WHERE id=${target.project_id} FOR SHARE`);
        const scopes = await tx.execute<{ id: number }>(sql`SELECT id FROM document_spaces WHERE team_id=${target.team_id} AND (project_id=${target.project_id} OR project_id IS NULL) ORDER BY id`);
        if (!scopes.length) throw new DocumentError(409, "SPACE_NOT_OPEN", "请先打开项目文档空间后重试");
        const spaces = await lockSpaces(tx, actor, scopes.map(s => s.id), !!input);
        const own = spaces.find(s => s.project_id === target.project_id);
        if (!own) throw new DocumentError(409, "SPACE_NOT_OPEN", "请先打开项目文档空间后重试");
        if (!(await tx.execute(sql`SELECT id FROM ${table} WHERE id=${targetId} AND project_id=${target.project_id} FOR SHARE`)).length) throw notFound();
        const read = async () => {
          const rows = await tx.execute<NodeRow>(sql`${nodeSelect} JOIN document_associations a ON a.node_id=n.id WHERE a.${column}=${targetId} AND n.state='active' ORDER BY n.name,n.id`);
          return { nodes: rows.filter(n => spaces.some(s => s.id === n.space_id)).map(n => nodeDto(n, spaceDto(spaces.find(s => s.id === n.space_id)!))), expectedVersion: String(own.version), readOnly: spaceDto(own).readOnly, projectId: target.project_id };
        };
        if (!input) return read();
        writable(own);
        return idempotent(tx, actor, "document.associate", input.requestId, { kind, targetId, ...input }, async () => {
          if (String(own.version) !== input.expectedVersion) throw new DocumentError(409, "VERSION_CONFLICT", "项目状态已变化，请刷新后重试");
          const nodes: NodeRow[] = [];
          for (const id of input.nodeIds) {
            const n = await getRow(tx, id);
            const source = spaces.find(s => s.id === n.space_id);
            if (!source) throw notFound();
            writable(source);
            if (n.kind === "folder") throw new DocumentError(400, "INVALID_TARGET", "请选择资料，不能关联文件夹");
            await trail(tx, id, n.space_id);
            nodes.push(n);
          }
          for (const n of nodes) {
            if (input.action === "add") await tx.execute(sql`INSERT INTO document_associations(node_id,${column},created_by) VALUES(${n.id},${targetId},${actor}) ON CONFLICT DO NOTHING`);
            else await tx.execute(sql`DELETE FROM document_associations WHERE node_id=${n.id} AND ${column}=${targetId}`);
          }
          return read();
        });
      });
    },

    async openSpace(actor: number, kind: "project" | "team", id: number) {
      return database.transaction(async tx => {
        // Authenticate the scope before checking module readiness or initializing metadata.
        const [scope] = await tx.execute<{ team_id: number; project_id: number | null }>(kind === "project"
          ? sql`SELECT p.team_id,p.id AS project_id FROM projects p JOIN team_members m ON m.team_id=p.team_id WHERE p.id=${id} AND m.user_id=${actor}`
          : sql`SELECT t.id AS team_id,NULL::integer AS project_id FROM teams t JOIN team_members m ON m.team_id=t.id WHERE t.id=${id} AND m.user_id=${actor}`);
        if (!scope) throw notFound();
        await tx.execute(sql`SELECT id FROM teams WHERE id=${scope.team_id} FOR SHARE`);
        if (scope.project_id) await tx.execute(sql`SELECT id FROM projects WHERE id=${scope.project_id} FOR SHARE`);
        const membership = await tx.execute(sql`SELECT id FROM team_members WHERE team_id=${scope.team_id} AND user_id=${actor} AND role IN ('owner','admin','member')`);
        if (!membership.length) throw notFound();
        await schemaReady(tx);
        let [space] = await tx.execute<{ id: number }>(sql`SELECT id FROM document_spaces WHERE team_id=${scope.team_id} AND project_id IS NOT DISTINCT FROM ${scope.project_id}::integer`);
        if (!space) {
          const inserted = await tx.execute<{ id: number }>(scope.project_id
            ? sql`INSERT INTO document_spaces(team_id,project_id) VALUES(${scope.team_id},${scope.project_id}) ON CONFLICT(project_id) DO NOTHING RETURNING id`
            : sql`INSERT INTO document_spaces(team_id) VALUES(${scope.team_id}) ON CONFLICT(team_id) WHERE project_id IS NULL DO NOTHING RETURNING id`);
          if (inserted[0]) {
            space = inserted[0];
            const defaults = scope.project_id
              ? [["default-documents", "项目文档"], ["default-records", "协作记录"], ["default-deliverables", "交付成果"]]
              : [["default-documents", "团队规范"], ["default-records", "共享参考"], ["default-deliverables", "公共素材"]];
            for (const [role, name] of defaults) {
              const [folder] = await tx.execute<{ id: number }>(sql`INSERT INTO document_nodes(space_id,kind,name,normalized_name,created_by,updated_by) VALUES(${space.id},'folder',${name},${name},${actor},${actor}) RETURNING id`);
              await tx.execute(sql`INSERT INTO document_migration_roots(space_id,role,node_id) VALUES(${space.id},${role},${folder.id})`);
            }
            if (scope.project_id) await tx.execute(sql`UPDATE document_spaces SET state='archived' WHERE id=${space.id} AND EXISTS(SELECT 1 FROM projects WHERE id=${scope.project_id} AND status='archived')`);
          } else [space] = await tx.execute<{ id: number }>(sql`SELECT id FROM document_spaces WHERE team_id=${scope.team_id} AND project_id IS NOT DISTINCT FROM ${scope.project_id}::integer`);
        }
        const [row] = await lockSpaces(tx, actor, [space.id], false);
        return { space: spaceDto(row) };
      });
    },

    async list(actor: number, spaceId: number, input: ListNodeInput): Promise<DocumentListing> {
      return database.transaction(async tx => {
        await schemaReady(tx);
        const [row] = await lockSpaces(tx, actor, [spaceId], false); const space = spaceDto(row);
        await parent(tx, input.parentId, spaceId);
        const path = input.parentId === null ? [] : await trail(tx, input.parentId, spaceId);
        const pattern = `%${input.q.replace(/[\\%_]/g, s => "\\" + s)}%`;
        const filter = sql`n.space_id=${spaceId} AND n.state='active' ${input.q ? sql`AND n.name ILIKE ${pattern} ESCAPE chr(92)` : sql`AND n.parent_id IS NOT DISTINCT FROM ${input.parentId}::integer`} ${input.foldersOnly ? sql`AND n.kind='folder'` : sql``}`;
        let after: SQL = sql``;
        const scopeKey = JSON.stringify([spaceId, input.parentId, input.q, input.sort, input.foldersOnly]);
        if (input.cursor) {
          try {
            const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
            if (c.scope !== scopeKey || ![0, 1].includes(c.rank) || !Number.isInteger(c.id) || c.id < 1 || c.id > 2147483647 || typeof c.name !== "string" || c.name.length > 200
              || typeof c.time !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/.test(c.time) || !Number.isFinite(Date.parse(c.time))
              || new Date(c.time.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !== c.time.slice(0, 10)) throw Error();
            const rank = sql`CASE WHEN n.kind='folder' THEN 0 ELSE 1 END`;
            const compare = input.sort === "name" ? sql`(n.normalized_name COLLATE "C">${c.name} OR (n.normalized_name COLLATE "C"=${c.name} AND n.id>${c.id}))`
              : sql`(n.updated_at<${c.time}::timestamptz OR (n.updated_at=${c.time}::timestamptz AND n.id>${c.id}))`;
            after = sql`AND (${rank}>${c.rank} OR (${rank}=${c.rank} AND ${compare}))`;
          } catch { throw new DocumentError(400, "INVALID_CURSOR", "列表位置已失效，请重新打开目录"); }
        }
        const rows = await tx.execute<NodeRow>(sql`${nodeSelect} WHERE ${filter} ${after} ORDER BY CASE WHEN n.kind='folder' THEN 0 ELSE 1 END,
          ${input.sort === "name" ? sql`n.normalized_name COLLATE "C" ASC` : sql`n.updated_at DESC`},n.id ASC LIMIT ${input.limit + 1}`);
        const selected = rows.slice(0, input.limit); const last = selected.at(-1);
        const [count] = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM document_nodes n WHERE ${filter}`);
        return { space, path, total: count.total, nodes: selected.map(n => nodeDto(n, space)), nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ scope: scopeKey, rank: last.kind === "folder" ? 0 : 1, name: last.normalized_name, time: last.updated_at, id: last.id })).toString("base64url") : null };
      });
    },

    async detail(actor: number, id: number, includeTrash=false): Promise<DocumentDetail> {
      return database.transaction(async tx => {
        await schemaReady(tx); const initial = await getRow(tx, id, includeTrash);
        const [s] = await lockSpaces(tx, actor, [initial.space_id], false); const space = spaceDto(s);
        const n = await getRow(tx, id, includeTrash);
        if (n.space_id !== s.id) throw new DocumentError(409, "VERSION_CONFLICT", "资料已移动，请刷新后重试");
        const path = n.state === "active" ? await trail(tx,id,n.space_id) : (await tx.execute<{original_path:DocumentPathItem[]}>(sql`SELECT original_path FROM document_trash_items WHERE node_id=${id}`))[0].original_path;
        const associations = await tx.execute<{ type: "task" | "milestone"; id: number; name: string; projectId: number }>(sql`SELECT CASE WHEN a.task_id IS NULL THEN 'milestone' ELSE 'task' END AS type,
          coalesce(a.task_id,a.milestone_id) AS id,coalesce(t.title,m.name) AS name,coalesce(t.project_id,m.project_id) AS "projectId"
          FROM document_associations a LEFT JOIN tasks t ON t.id=a.task_id LEFT JOIN milestones m ON m.id=a.milestone_id WHERE a.node_id=${id} ORDER BY a.id`);
        const result: DocumentDetail = { node: nodeDto(n, space), space, path, trashed:n.state!=="active", associations: [...associations] };
        if (n.kind === "document") result.body = (await tx.execute<{ content_json: unknown }>(sql`SELECT content_json FROM document_bodies WHERE node_id=${id}`))[0]?.content_json;
        if (n.kind === "link") result.url = (await tx.execute<{ url: string }>(sql`SELECT url FROM document_link_entries WHERE node_id=${id}`))[0]?.url;
        if(n.kind === "file") {
          const [file]=await tx.execute<{resourceId:number;mimeType:string;size:string;uploadedBy:string;originalUploader:string;uploadedAt:string}>(sql`SELECT r.id AS "resourceId",coalesce(nullif(u.name,''),u.student_id,'已删除成员') AS "uploadedBy",coalesce(nullif(o.name,''),o.student_id,'已删除成员') AS "originalUploader",r.created_at::text AS "uploadedAt",r.mime_type AS "mimeType",r.size::text FROM document_file_entries f JOIN document_resources r ON r.id=f.resource_id LEFT JOIN users u ON u.id=r.created_by LEFT JOIN document_nodes dn ON dn.id=f.node_id LEFT JOIN users o ON o.id=dn.created_by WHERE f.node_id=${id} AND r.state='ready'`);
          if(file) result.file={...file,url:`/api/document-nodes/${id}/file${n.state==="active"?"":"?trash=1"}`,preview:["image/png","image/jpeg","image/webp","image/gif","application/pdf","video/mp4","video/webm"].includes(file.mimeType)};
        }
        if (n.kind === "file") { const [legacy] = await tx.execute<{ id: number }>(sql`SELECT legacy_attachment_id AS id FROM document_legacy_files WHERE node_id=${id}`); if (legacy) result.legacyDownloadUrl = `/api/files/${legacy.id}`; }
        result.operations=[...await tx.execute<{id:number;action:string;actor:string;createdAt:string}>(sql`SELECT op.id,op.action,coalesce(nullif(u.name,''),u.student_id,'已删除成员') AS actor,op.created_at::text AS "createdAt" FROM document_operations op LEFT JOIN users u ON u.id=op.actor_id WHERE op.node_id=${id} ORDER BY op.id DESC LIMIT 50`)];
        return result;
      });
    },

    async create(actor: number, spaceId: number, input: CreateNodeInput) {
      return database.transaction(async tx => {
        await schemaReady(tx); const [s] = await lockSpaces(tx, actor, [spaceId], true); writable(s);
        return idempotent(tx, actor, "document.create", input.requestId, { spaceId, ...input }, async () => {
          await parent(tx, input.parentId, spaceId); await unique(tx, spaceId, input.parentId, input.name);
          const [n] = await tx.execute<{ id: number }>(sql`INSERT INTO document_nodes(space_id,parent_id,kind,name,normalized_name,created_by,updated_by)
            VALUES(${spaceId},${input.parentId},${input.kind},${input.name},${normalize(input.name)},${actor},${actor}) RETURNING id`);
          if (input.kind === "document") {
            const body = templateBody(input.templateKey);
            await tx.execute(sql`INSERT INTO document_bodies(node_id,content_json,content_hash,updated_by) VALUES(${n.id},${JSON.stringify(body)}::jsonb,${createHash("sha256").update(JSON.stringify(body)).digest("hex")},${actor})`);
          }
          if (input.kind === "link") await tx.execute(sql`INSERT INTO document_link_entries(node_id,url) VALUES(${n.id},${input.url})`);
          return { node: nodeDto(await getRow(tx, n.id), spaceDto(s)) };
        });
      });
    },

    async updateLink(actor:number,id:number,input:{name:string;url:string;expectedVersion:string;expectedAssociations:number;confirmImpact:true;requestId:string}){
      return database.transaction(async tx=>{await schemaReady(tx);const initial=await getRow(tx,id);const [space]=await lockSpaces(tx,actor,[initial.space_id],true);writable(space);
        return idempotent(tx,actor,"document.link",input.requestId,{id,...input},async()=>{const node=await getRow(tx,id);if(node.kind!=="link"||node.space_id!==space.id)throw notFound();if(String(node.version)!==input.expectedVersion)throw new DocumentError(409,"VERSION_CONFLICT","链接已变化，请刷新");
          const [count]=await tx.execute<{total:number}>(sql`SELECT count(*)::int AS total FROM document_associations WHERE node_id=${id}`);if(!input.confirmImpact||count.total!==input.expectedAssociations)throw new DocumentError(409,"SCOPE_CHANGED","关联范围已变化，请重新核对");await unique(tx,space.id,node.parent_id,input.name,id);
          const [before]=await tx.execute<{url:string}>(sql`SELECT url FROM document_link_entries WHERE node_id=${id}`);await tx.execute(sql`UPDATE document_link_entries SET url=${input.url} WHERE node_id=${id}`);await tx.execute(sql`UPDATE document_nodes SET name=${input.name},normalized_name=${normalize(input.name)},version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id=${id}`);
          await tx.execute(sql`UPDATE milestone_resources SET title=${input.name},url=${input.url} WHERE id IN (SELECT legacy_resource_id FROM document_legacy_links WHERE node_id=${id})`);
          await tx.execute(sql`INSERT INTO document_operations(node_id,actor_id,action,detail) VALUES(${id},${actor},'link.updated',${JSON.stringify({previousUrl:before.url,url:input.url})}::jsonb)`);return {node:nodeDto(await getRow(tx,id),spaceDto(space))};});});
    },
    async rename(actor: number, id: number, input: RenameNodeInput) {
      return database.transaction(async tx => {
        await schemaReady(tx); const initial = await getRow(tx, id); const [s] = await lockSpaces(tx, actor, [initial.space_id], true); writable(s);
        const n = await getRow(tx, id);
        if (n.space_id !== s.id || String(n.version) !== input.expectedVersion) throw new DocumentError(409, "VERSION_CONFLICT", "资料已被修改，请刷新后重试");
        if (n.editor_id) throw new DocumentError(409, "DOCUMENT_EDITING", "文档正在编辑，请结束编辑后再重命名");
        await unique(tx, s.id, n.parent_id, input.name, id);
        await tx.execute(sql`UPDATE document_nodes SET name=${input.name},normalized_name=${normalize(input.name)},version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id=${id}`);
        return { node: nodeDto(await getRow(tx, id), spaceDto(s)) };
      });
    },

    async move(actor: number, id: number, input: MoveNodeInput) {
      return database.transaction(async tx => {
        await schemaReady(tx); const initial = await getRow(tx, id);
        const spaces = await lockSpaces(tx, actor, [initial.space_id, input.targetSpaceId], true);
        const source = spaces.find(s => s.id === initial.space_id)!; const target = spaces.find(s => s.id === input.targetSpaceId)!;
        writable(source); writable(target);
        if (source.team_id !== target.team_id) throw new DocumentError(400, "CROSS_TEAM_MOVE", "不能跨团队移动资料");
        const n = await getRow(tx, id);
        return idempotent(tx, actor, "document.move", input.requestId, { id, ...input }, async () => {
          if (n.space_id !== source.id || String(n.version) !== input.expectedVersion) throw new DocumentError(409, "VERSION_CONFLICT", "资料已被修改，请刷新后重试");
          await parent(tx, input.targetParentId, target.id);
          if (input.targetParentId === null && n.kind !== "folder") throw new DocumentError(400, "INVALID_TARGET", "资料必须放在分区或文件夹内");
          const subtree = await tx.execute<{ id: number }>(sql`WITH RECURSIVE children AS (SELECT id FROM document_nodes WHERE id=${id} UNION SELECT c.id FROM document_nodes c JOIN children p ON c.parent_id=p.id) SELECT id FROM children ORDER BY id`);
          const ids = subtree.map(x => x.id);
          if (input.targetParentId !== null && ids.includes(input.targetParentId)) throw new DocumentError(400, "DIRECTORY_CYCLE", "不能移入自身或自己的子目录");
          const inside = sql.join(ids.map(x => sql`${x}`), sql`,`);
          if ((await tx.execute(sql`SELECT node_id FROM document_edit_locks WHERE node_id IN (${inside}) AND expires_at>clock_timestamp() LIMIT 1`)).length) throw new DocumentError(409, "DOCUMENT_EDITING", "目录内有正在编辑的文档，请等待编辑结束");
          if (source.id !== target.id && (await tx.execute(sql`SELECT id FROM document_associations WHERE node_id IN (${inside}) LIMIT 1`)).length) throw new DocumentError(409, "REFERENCE_EXISTS", "跨空间移动前请先解除全部任务或里程碑关联");
          if(source.id!==target.id){
            await tx.execute(sql`UPDATE document_trash_batches SET space_id=${target.id} WHERE id IN (SELECT DISTINCT trash_batch_id FROM document_nodes WHERE id IN (${inside}) AND trash_batch_id IS NOT NULL)`);
            await tx.execute(sql`UPDATE document_trash_items SET original_space_id=${target.id} WHERE node_id IN (${inside})`);
          }
          await unique(tx, target.id, input.targetParentId, n.name, id);
          if (n.parent_id === null && (source.id !== target.id || input.targetParentId !== null)) {
            const [roots] = await tx.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM document_nodes WHERE space_id=${source.id} AND parent_id IS NULL AND state='active'`);
            if (roots.total <= 1) throw new DocumentError(409, "LAST_PARTITION", "空间至少需要保留一个分区");
          }
          await tx.execute(sql`UPDATE document_nodes SET space_id=${target.id},parent_id=CASE WHEN id=${id} THEN ${input.targetParentId}::integer ELSE parent_id END,
            system_role=CASE WHEN id=${id} AND (${input.targetParentId}::integer IS NOT NULL OR space_id<>${target.id}) THEN NULL ELSE system_role END,
            version=version+1,updated_by=${actor},updated_at=clock_timestamp() WHERE id IN (${inside})`);
          return { node: nodeDto(await getRow(tx, id), spaceDto(target)), path: await trail(tx, id, target.id) };
        });
      });
    },
  };
}
export const documentService = createDocumentService();
