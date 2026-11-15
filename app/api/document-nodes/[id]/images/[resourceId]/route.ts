import {requireUser} from "@/lib/api";
import {documentId} from "@/lib/documents/http";
import {documentErrorResponse} from "@/lib/documents/errors";
import {documentService} from "@/lib/documents/service";
import {fileResponse} from "@/lib/documents/file-response";
async function serve(request:Request,params:Promise<{id:string;resourceId:string}>,head:boolean){try{
 const actor=await requireUser(request);const p=await params;const query=new URL(request.url).searchParams;const version=query.get("versionId");
 const image=await documentService.image(actor.id,documentId(p.id),documentId(p.resourceId),version?documentId(version):undefined,query.get("trash")==="1");return await fileResponse(request,image,head,true);
}catch(error){return documentErrorResponse(error);}}
export async function GET(request:Request,{params}:{params:Promise<{id:string;resourceId:string}>}){return serve(request,params,false);}
export async function HEAD(request:Request,{params}:{params:Promise<{id:string;resourceId:string}>}){return serve(request,params,true);}
