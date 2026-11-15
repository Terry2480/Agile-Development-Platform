import {requireUser} from "@/lib/api";
import {documentId} from "@/lib/documents/http";
import {documentErrorResponse} from "@/lib/documents/errors";
import {documentService} from "@/lib/documents/service";
import {fileResponse} from "@/lib/documents/file-response";
async function serve(request:Request,params:Promise<{id:string}>,head:boolean){try{const actor=await requireUser(request);const file=await documentService.file(actor.id,documentId((await params).id),new URL(request.url).searchParams.get("trash")==="1");return await fileResponse(request,file,head);}catch(error){return documentErrorResponse(error);}}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,false);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,true);}
