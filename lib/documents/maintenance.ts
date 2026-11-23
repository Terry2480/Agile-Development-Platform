import {sql} from "drizzle-orm";
import {unlink} from "node:fs/promises";
import {db} from "@/db";
import {uploadPath} from "@/lib/file-cleanup";
import {createDocumentService} from "./service";
export function createDocumentMaintenance(database:typeof db=db) {
  return async function maintain(limit=20) {
    const [ready]=await database.execute<{ready:boolean}>(sql`SELECT to_regclass('public.document_cleanup_jobs') IS NOT NULL AS ready`);
    if(!ready.ready)return;
    await database.execute(sql`DELETE FROM document_requests WHERE id IN (SELECT id FROM document_requests WHERE expires_at<=clock_timestamp() AND state='completed' ORDER BY id LIMIT 500)`);
    const service=createDocumentService(database);
    const expired=await database.execute<{id:number;version:string;owner_id:number}>(sql`SELECT n.id,n.version::text,t.owner_id FROM document_nodes n JOIN document_spaces s ON s.id=n.space_id JOIN teams t ON t.id=s.team_id WHERE n.state='trashed' AND n.expires_at<=clock_timestamp() ORDER BY n.expires_at,n.id LIMIT ${limit}`);
    for(const node of expired){try{await service.purge(node.owner_id,node.id,{expectedVersion:node.version,requestId:`expire-${node.id}-${node.version}`,confirmPermanent:true},true);}catch{/* Recheck on the next pass if another worker or restore changed this node. */}}
    for(let i=0;i<limit;i++) {
      const found=await database.transaction(async tx=>{
        const [job]=await tx.execute<{resource_id:number}>(sql`SELECT resource_id FROM document_cleanup_jobs WHERE not_before<=clock_timestamp() ORDER BY not_before,resource_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if(!job)return false;
        const [resource]=await tx.execute<{stored_name:string;staged_for_node_id:number|null}>(sql`SELECT stored_name,staged_for_node_id FROM document_resources WHERE id=${job.resource_id} FOR UPDATE`);
        if(!resource){await tx.execute(sql`DELETE FROM document_cleanup_jobs WHERE resource_id=${job.resource_id}`);return true;}
        const references=await tx.execute(sql`SELECT id FROM document_resource_refs WHERE resource_id=${job.resource_id} LIMIT 1`);
        if(references.length){await tx.execute(sql`DELETE FROM document_cleanup_jobs WHERE resource_id=${job.resource_id}`);return true;}
        const grants=await tx.execute(sql`SELECT resource_id FROM document_image_grants WHERE resource_id=${job.resource_id} AND expires_at>clock_timestamp() LIMIT 1`);
        const locks=resource.staged_for_node_id?await tx.execute(sql`SELECT node_id FROM document_edit_locks WHERE node_id=${resource.staged_for_node_id} AND expires_at>clock_timestamp()`):[];
        if(grants.length||locks.length){await tx.execute(sql`UPDATE document_cleanup_jobs SET not_before=clock_timestamp()+interval '2 minutes' WHERE resource_id=${job.resource_id}`);return true;}
        try {
          await unlink(/* turbopackIgnore: true */ uploadPath(resource.stored_name)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=="ENOENT")throw e;});
          await tx.execute(sql`DELETE FROM document_image_grants WHERE resource_id=${job.resource_id}`);
          await tx.execute(sql`DELETE FROM document_resources WHERE id=${job.resource_id}`);
        }catch(error){await tx.execute(sql`UPDATE document_cleanup_jobs SET attempts=attempts+1,last_error=${(error as {code?:string}).code??"CLEANUP_FAILED"},not_before=clock_timestamp()+interval '1 minute' WHERE resource_id=${job.resource_id}`);}
        return true;
      });
      if(!found)break;
    }
  };
}
export async function tryDocumentMaintenance(){try{await createDocumentMaintenance()();}catch{console.error("[documents] maintenance deferred; will retry");}}
