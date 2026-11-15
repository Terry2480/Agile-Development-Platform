import {stat} from "node:fs/promises";
import {requireUser} from "@/lib/api";
import {documentId} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {DocumentError,documentErrorResponse} from "@/lib/documents/errors";
import {exportPath} from "@/lib/documents/export-worker";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import {fileDisposition} from "@/lib/documents/files";
async function serve(request:Request,params:Promise<{id:string}>,head:boolean){try{const actor=await requireUser(request);const id=documentId((await params).id);const job=await documentService.exportFile(actor.id,id);const filename=exportPath(job.artifactName);const info=await stat(/* turbopackIgnore: true */ filename).catch(()=>{throw new DocumentError(404,"EXPORT_FILE_MISSING","导出产物缺失，请重新发起任务");});const headers={"Content-Type":job.artifactName.endsWith(".pdf")?"application/pdf":"application/zip","Content-Length":String(info.size),"Content-Disposition":fileDisposition(`文档导出-${id}${job.partial?"-部分结果":""}.${job.artifactName.endsWith(".pdf")?"pdf":"zip"}`,false),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};return new Response(head?null:Readable.toWeb(createReadStream(/* turbopackIgnore: true */ filename)) as ReadableStream<Uint8Array>,{headers});}catch(error){return documentErrorResponse(error);}}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,false);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,true);}
