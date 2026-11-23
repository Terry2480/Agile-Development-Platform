import {sql} from "drizzle-orm";
import {access,mkdir,readFile,readdir,stat,unlink,writeFile} from "node:fs/promises";
import {createWriteStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {ZipFile} from "yazl";
import {chromium,type Browser} from "playwright-core";
import {db} from "@/db";
import {uploadPath} from "@/lib/file-cleanup";
import type {BodyNode} from "./body";
import {bodyHtml,bodyMarkdown,htmlDocument,imageIds} from "./export-format";
const MAX=524288000;
export function exportPath(name:string){if(!/^[a-f0-9-]+\.(zip|pdf)$/.test(name))throw Error("INVALID_EXPORT_PATH");return path.join(/* turbopackIgnore: true */ path.dirname(uploadPath("root")),".document-exports",name);}
type Job={id:number;space_id:number;team_id:number;requested_by:number;format:"pdf"|"markdown";attempts:number;snapshot_metadata:{directPdf?:boolean;directories?:{id:number;path:string}[]}};
type Item={id:number;node_id:number;relative_path:string;kind:"document"|"file"|"link";snapshot_name:string;snapshot_body:BodyNode|null;snapshot_url:string|null;resource_id:number|null};
async function browserPath(){const paths=[process.env.DOCUMENT_BROWSER_PATH,"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome"].filter((s):s is string=>!!s);for(const candidate of paths){try{await access(/* turbopackIgnore: true */ candidate);return candidate;}catch{}}throw Error("PDF_BROWSER_NOT_CONFIGURED");}
export function createDocumentExportWorker(database:typeof db=db){
  async function lockSpace(tx:Pick<typeof db,"execute">,id:number){await tx.execute(sql`SELECT id FROM document_spaces WHERE id=${id} FOR UPDATE`);}
  return async function runExports(limit=1){
    const [ready]=await database.execute<{ready:boolean}>(sql`SELECT to_regclass('public.document_exports') IS NOT NULL AS ready`);if(!ready.ready)return;
    // Clean crash artifacts and jobs deleted with a project/team. Only owned UUID
    // files older than 24h are eligible; a live job always protects its artifact.
    const artifactDir=path.dirname(exportPath("00000000-0000-0000-0000-000000000000.zip"));
    for(const name of await readdir(/* turbopackIgnore: true */ artifactDir).catch(()=>[])){
      if(!/^[a-f0-9-]+\.(zip|pdf)$/.test(name))continue;
      const file=exportPath(name);const info=await stat(/* turbopackIgnore: true */ file).catch(()=>null);
      if(!info||info.mtimeMs>Date.now()-86400000)continue;
      if(!(await database.execute(sql`SELECT id FROM document_exports WHERE artifact_name=${name}`)).length)await unlink(/* turbopackIgnore: true */ file).catch(()=>{});
    }
    const old=await database.execute<{id:number;space_id:number;artifact_name:string|null}>(sql`SELECT id,space_id,artifact_name FROM document_exports WHERE expires_at<=clock_timestamp() AND state<>'expired' ORDER BY id LIMIT 20`);
    for(const job of old){if(job.artifact_name)await unlink(/* turbopackIgnore: true */ exportPath(job.artifact_name)).catch(()=>{});await database.transaction(async tx=>{await lockSpace(tx,job.space_id);await tx.execute(sql`SELECT id FROM document_exports WHERE id=${job.id} FOR UPDATE`);await tx.execute(sql`INSERT INTO document_cleanup_jobs(resource_id,not_before) SELECT DISTINCT r.resource_id,clock_timestamp() FROM document_resource_refs r JOIN document_export_items i ON i.id=r.export_item_id WHERE i.export_id=${job.id} ON CONFLICT DO NOTHING`);await tx.execute(sql`DELETE FROM document_export_items WHERE export_id=${job.id}`);await tx.execute(sql`UPDATE document_exports SET state='expired',artifact_name=NULL,lease_until=NULL WHERE id=${job.id}`);});}
    for(let attempt=0;attempt<limit;attempt++){
      const candidates=await database.execute<{id:number;space_id:number}>(sql`SELECT id,space_id FROM document_exports WHERE expires_at>clock_timestamp() AND (state='queued' OR (state='running' AND lease_until<clock_timestamp())) ORDER BY id LIMIT 10`);
      let job:Job|undefined;
      for(const candidate of candidates){job=await database.transaction(async tx=>{
        await lockSpace(tx,candidate.space_id);
        const [row]=await tx.execute<Job>(sql`SELECT * FROM document_exports WHERE id=${candidate.id} AND expires_at>clock_timestamp() AND (state='queued' OR (state='running' AND lease_until<clock_timestamp())) FOR UPDATE SKIP LOCKED`);if(!row)return;
        if(!(await tx.execute(sql`SELECT id FROM team_members WHERE team_id=${row.team_id} AND user_id=${row.requested_by}`)).length){await tx.execute(sql`UPDATE document_exports SET state='cancelled',lease_until=NULL WHERE id=${row.id}`);return;}
        await tx.execute(sql`UPDATE document_exports SET state='running',attempts=attempts+1,lease_until=clock_timestamp()+interval '5 minutes',failure_manifest='[]'::jsonb,updated_at=clock_timestamp() WHERE id=${row.id}`);
        await tx.execute(sql`UPDATE document_export_items SET state='pending',error_code=NULL,output_size=0 WHERE export_id=${row.id}`);
        return {...row,attempts:row.attempts+1};
      });if(job)break;}
      if(!job)break;
      const current=job;let browser:Browser|undefined;const itemFailures:{path:string;code:string}[]=[];const name=`${randomUUID()}.${job.snapshot_metadata.directPdf?"pdf":"zip"}`;const output=exportPath(name);
      let heartbeatRunning=false;
      const heartbeat=setInterval(()=>{if(heartbeatRunning)return;heartbeatRunning=true;void database.transaction(async tx=>{await lockSpace(tx,current.space_id);await tx.execute(sql`UPDATE document_exports SET lease_until=clock_timestamp()+interval '5 minutes' WHERE id=${current.id} AND attempts=${current.attempts} AND state='running'`);}).catch(()=>{}).finally(()=>{heartbeatRunning=false;});},30000);heartbeat.unref();
      try {
        await mkdir(path.dirname(output),{recursive:true});
        const items=await database.execute<Item>(sql`SELECT * FROM document_export_items WHERE export_id=${job.id} ORDER BY id`);
        const entries:{name:string;buffer?:Buffer;file?:string}[]=[];const addedImages=new Set<number>();let assets="_文档图片";const failures=itemFailures;const links:string[]=[];let total=0;let successful=0;
        while(items.some(item=>item.relative_path.toLowerCase().startsWith(assets.toLowerCase()+"/")))assets+="_";
        const occupied=new Set(items.map(item=>item.relative_path.toLowerCase()));
        function auxiliary(name:string){let value=name;while(occupied.has(value.toLowerCase()))value="_"+value;occupied.add(value.toLowerCase());return value;}
        const reserve=(bytes:number)=>{if(total+bytes>MAX)throw Error("EXPORT_SIZE_LIMIT");total+=bytes;};
        for(const item of items){let size=0;try{
          if(item.kind==="file"){
            const [resource]=await database.execute<{stored_name:string;size:string}>(sql`SELECT stored_name,size::text FROM document_resources WHERE id=${item.resource_id} AND state='ready'`);if(!resource)throw Error("FILE_RESOURCE_MISSING");
            const file=uploadPath(resource.stored_name);const info=await stat(/* turbopackIgnore: true */ file);if(!info.isFile()||String(info.size)!==resource.size)throw Error("FILE_MISSING_OR_CHANGED");reserve(info.size);size=info.size;entries.push({name:item.relative_path,file});
          }else if(item.kind==="link"){
            const text=`${item.snapshot_name}\n${item.snapshot_url}\n`;const buffer=Buffer.from(text);reserve(buffer.length);size=buffer.length;entries.push({name:item.relative_path,buffer});links.push(`- ${item.relative_path}: ${item.snapshot_url}`);
          }else{
            const images=new Map<number,{mime:string;bytes:Buffer;name:string}>();let imageBytes=0;
            for(const resourceId of imageIds(item.snapshot_body!)){
              const [resource]=await database.execute<{stored_name:string;mime_type:string;size:string}>(sql`SELECT r.stored_name,r.mime_type,r.size::text FROM document_resources r JOIN document_resource_refs ref ON ref.resource_id=r.id WHERE ref.export_item_id=${item.id} AND r.id=${resourceId} AND r.state='ready'`);if(!resource)throw Error("IMAGE_RESOURCE_MISSING");
              const bytes=await readFile(/* turbopackIgnore: true */ uploadPath(resource.stored_name));if(String(bytes.length)!==resource.size)throw Error("IMAGE_MISSING_OR_CHANGED");imageBytes+=bytes.length;if(imageBytes>MAX)throw Error("EXPORT_SIZE_LIMIT");
              images.set(resourceId,{mime:resource.mime_type,bytes,name:`${assets}/${resourceId}.${resource.mime_type==="image/jpeg"?"jpg":resource.mime_type==="image/webp"?"webp":"png"}`});
            }
            let buffer:Buffer;
            if(job.format==="markdown"){
              buffer=Buffer.from(`# ${item.snapshot_name}\n\n`+bodyMarkdown(item.snapshot_body!,resourceId=>encodeURI(path.posix.relative(path.posix.dirname(item.relative_path),images.get(resourceId)!.name))));
              for(const [resourceId,image] of images)if(!addedImages.has(resourceId)){reserve(image.bytes.length);size+=image.bytes.length;entries.push({name:image.name,buffer:image.bytes});addedImages.add(resourceId);}
            }else{
              browser??=await chromium.launch({executablePath:await browserPath(),headless:true});const page=await browser.newPage();try{
                await page.route("**/*",route=>route.abort());
                await page.setContent(htmlDocument(item.snapshot_name,bodyHtml(item.snapshot_body!,resourceId=>{const image=images.get(resourceId)!;return `data:${image.mime};base64,${image.bytes.toString("base64")}`;})),{waitUntil:"load",timeout:30000});
                await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
                buffer=await page.pdf({format:"A4",printBackground:true,preferCSSPageSize:true});
              }finally{await page.close();}
            }
            reserve(buffer.length);size+=buffer.length;entries.push({name:item.relative_path,buffer});
          }
          successful++;await database.transaction(async tx=>{await lockSpace(tx,current.space_id);await tx.execute(sql`UPDATE document_export_items SET state='completed',output_size=${size},error_code=NULL WHERE id=${item.id} AND EXISTS(SELECT 1 FROM document_exports WHERE id=${current.id} AND attempts=${current.attempts} AND state='running')`);});
        }catch(error){const raw=(error as {code?:string}).code??(error as Error).message??"EXPORT_ITEM_FAILED";const code=/^[A-Z_0-9]{1,80}$/.test(raw)?raw:"EXPORT_ITEM_FAILED";if(code==="EXPORT_SIZE_LIMIT")throw error;failures.push({path:item.relative_path,code});await database.transaction(async tx=>{await lockSpace(tx,current.space_id);await tx.execute(sql`UPDATE document_export_items SET state='failed',output_size=0,error_code=${code} WHERE id=${item.id} AND EXISTS(SELECT 1 FROM document_exports WHERE id=${current.id} AND attempts=${current.attempts} AND state='running')`);});}}
        if(!successful&&items.length)throw Error("ALL_ITEMS_FAILED");
        if(job.snapshot_metadata.directPdf){const pdf=entries.find(e=>e.name.endsWith(".pdf"))?.buffer;if(!pdf)throw Error("PDF_GENERATION_FAILED");await writeFile(/* turbopackIgnore: true */ output,pdf,{flag:"wx"});}
        else{
          const auxiliaryEntries:{name:string;buffer:Buffer}[]=[];
          if(links.length){const buffer=Buffer.from("# 外部链接清单\n\n"+links.join("\n"));reserve(buffer.length);auxiliaryEntries.push({name:auxiliary(`_链接清单_${job.id}.md`),buffer});}
          if(failures.length){const buffer=Buffer.from(JSON.stringify(failures,null,2));reserve(buffer.length);auxiliaryEntries.push({name:auxiliary(`_失败清单_${job.id}.json`),buffer});}
          const zip=new ZipFile();const writing=pipeline(zip.outputStream,createWriteStream(/* turbopackIgnore: true */ output,{flags:"wx"}));
          for(const dir of job.snapshot_metadata.directories??[])zip.addEmptyDirectory(dir.path);
          for(const entry of entries)if(entry.buffer)zip.addBuffer(entry.buffer,entry.name);else zip.addFile(entry.file!,entry.name);
          for(const entry of auxiliaryEntries)zip.addBuffer(entry.buffer,entry.name);
          zip.end();await writing;
        }
        const published=await database.transaction(async tx=>{await lockSpace(tx,current.space_id);return tx.execute(sql`UPDATE document_exports SET state=${failures.length?"partial":"completed"},artifact_name=${name},failure_manifest=${JSON.stringify(failures)}::jsonb,lease_until=NULL,updated_at=clock_timestamp() WHERE id=${current.id} AND state='running' AND attempts=${current.attempts} AND expires_at>clock_timestamp() RETURNING id`);});
        if(!published.length)await unlink(/* turbopackIgnore: true */ output).catch(()=>{});
      }catch(error){await unlink(/* turbopackIgnore: true */ output).catch(()=>{});await database.transaction(async tx=>{await lockSpace(tx,current.space_id);await tx.execute(sql`UPDATE document_exports SET state='failed',failure_manifest=${JSON.stringify([...itemFailures,{path:"整个任务",code:/^[A-Z_0-9]{1,80}$/.test((error as Error).message??"")?(error as Error).message:"EXPORT_FAILED"}])}::jsonb,lease_until=NULL,updated_at=clock_timestamp() WHERE id=${current.id} AND state='running' AND attempts=${current.attempts}`);});}
      finally{clearInterval(heartbeat);await browser?.close();}
    }
  };
}
export async function tryDocumentExports(){try{await createDocumentExportWorker()();}catch{console.error("[documents] export worker deferred; will retry");}}
