import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@/db";
import {documentService} from "./service";
import {DocumentError,documentErrorResponse} from "./errors";
import {fileResponse} from "./file-response";
import {uploadDocumentInput,trashInput} from "./validation";
import {documentsEnabled} from "./lifecycle";

export async function legacyFile(request:Request,actor:number,id:number){
  if(!await documentsEnabled())return null;
  try{
    const [mapping]=await db.execute<{node_id:number}>(sql`SELECT node_id FROM document_legacy_files WHERE legacy_attachment_id=${id}`);
    if(!mapping)throw new DocumentError(404,"NOT_FOUND","文件不存在或尚未完成迁移");
    if(request.method==="DELETE"){
      const input=trashInput.parse(await request.json().catch(()=>({})));
      return Response.json(await documentService.trash(actor,mapping.node_id,input));
    }
    return fileResponse(request,await documentService.file(actor,mapping.node_id),request.method==="HEAD");
  }catch(error){return documentErrorResponse(error);}
}
export async function legacyProjectFiles(request:Request,actor:number,projectId:number){
  if(!await documentsEnabled())return null;
  try{
    const opened=await documentService.openSpace(actor,"project",projectId);
    if(request.method==="GET"){
      const raw=new URL(request.url).searchParams.get("taskId");const taskId=raw===null?null:Number(raw);
      if(taskId!==null){if(!Number.isSafeInteger(taskId)||taskId<1)throw new DocumentError(400,"INVALID_INPUT","任务编号不合法");await documentService.associations(actor,"task",taskId);if(!(await db.execute(sql`SELECT id FROM tasks WHERE id=${taskId} AND project_id=${projectId}`)).length)throw new DocumentError(404,"NOT_FOUND","任务不存在");}
      const files=await db.execute(sql`SELECT l.legacy_attachment_id AS id,n.id AS "documentNodeId",n.name AS "originalName",r.mime_type AS "mimeType",r.size::float8 AS size,r.created_by AS "uploaderId",n.created_at AS "createdAt",u.name AS "uploaderName",u.student_id AS "uploaderStudentId" FROM document_nodes n JOIN document_file_entries f ON f.node_id=n.id JOIN document_resources r ON r.id=f.resource_id JOIN document_legacy_files l ON l.node_id=n.id LEFT JOIN users u ON u.id=r.created_by WHERE n.space_id=${opened.space.id} AND n.state='active' ${taskId===null?sql``:sql`AND EXISTS(SELECT 1 FROM document_associations a WHERE a.node_id=n.id AND a.task_id=${taskId})`} ORDER BY n.id DESC`);
      return Response.json({files});
    }
    if(opened.space.readOnly)throw new DocumentError(403,"READ_ONLY_SPACE","项目已归档，只能阅读");
    if(Number(request.headers.get("content-length")??0)>101*1024*1024)throw new DocumentError(413,"INVALID_FILE","文件不能超过 100MB");
    const form=await request.formData();const file=form.get("file");
    if(!(file instanceof File)||!file.size||file.size>100*1024*1024)throw new DocumentError(400,"INVALID_FILE","请选择非空且不超过 100MB 的文件");
    if(!form.has("parentId"))throw new DocumentError(400,"DIRECTORY_REQUIRED","请从关联资料的“上传并关联”入口选择项目目录");
    const input=uploadDocumentInput.parse({parentId:Number(form.get("parentId")),requestId:form.get("requestId")??randomUUID(),...(form.has("taskId")?{taskId:Number(form.get("taskId"))}:{}),...(form.has("milestoneId")?{milestoneId:Number(form.get("milestoneId"))}:{})});
    const result=await documentService.upload(actor,opened.space.id,{...input,name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
    return Response.json({file:{id:result.legacyId,documentNodeId:result.node.id,originalName:result.node.name,size:file.size},node:result.node},{status:201});
  }catch(error){return documentErrorResponse(error);}
}

export async function canonicalTaskFiles(taskId:number){return db.execute<{id:number;originalName:string;size:number;mimeType:string;createdAt:Date}>(sql`SELECT coalesce(l.legacy_attachment_id,n.id) AS id,n.id AS "documentNodeId",n.name AS "originalName",r.size::float8 AS size,r.mime_type AS "mimeType",n.created_at AS "createdAt",('/api/document-nodes/'||n.id||'/file') AS "downloadUrl" FROM document_associations a JOIN document_nodes n ON n.id=a.node_id JOIN document_file_entries f ON f.node_id=n.id JOIN document_resources r ON r.id=f.resource_id LEFT JOIN document_legacy_files l ON l.node_id=n.id WHERE a.task_id=${taskId} AND n.state='active' ORDER BY n.id DESC`);}
export async function canonicalTaskFileCounts(ids:number[]){if(!ids.length)return [];return db.execute<{taskId:number;count:number}>(sql`SELECT a.task_id AS "taskId",count(*)::int AS count FROM document_associations a JOIN document_nodes n ON n.id=a.node_id WHERE a.task_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND n.kind='file' AND n.state='active' GROUP BY a.task_id`);}
