import {requireUser} from "@/lib/api";
import {documentId} from "@/lib/documents/http";
import {DocumentError,documentErrorResponse} from "@/lib/documents/errors";
import {documentService} from "@/lib/documents/service";
import {fileReplaceInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const actor=await requireUser(request);const id=documentId((await params).id);const detail=await documentService.detail(actor.id,id);
 if(!detail.file||detail.node.parentId===null)throw new DocumentError(400,"INVALID_TARGET","请选择上传文件");if(detail.space.readOnly)throw new DocumentError(403,"READ_ONLY_SPACE","归档项目禁止替换文件");if(Number(request.headers.get("content-length")??0)>101*1024*1024)throw new DocumentError(413,"INVALID_FILE","单文件不能超过 100MB");
 const form=await request.formData();if([...form.keys()].some(k=>!["file","expectedVersion","expectedResourceId","expectedAssociations","confirmImpact","requestId"].includes(k))||[...form.keys()].some(k=>form.getAll(k).length!==1))throw new DocumentError(400,"INVALID_INPUT","表单不合法");const file=form.get("file");if(!(file instanceof File)||!file.size||file.size>100*1024*1024)throw new DocumentError(400,"INVALID_FILE","请选择非空且不超过 100MB 的文件");
 const input=fileReplaceInput.parse({expectedVersion:form.get("expectedVersion"),expectedResourceId:Number(form.get("expectedResourceId")),expectedAssociations:Number(form.get("expectedAssociations")),confirmImpact:form.get("confirmImpact")==="true",requestId:form.get("requestId")});
 return Response.json(await documentService.upload(actor.id,detail.space.id,{parentId:detail.node.parentId,requestId:input.requestId,name:file.name,bytes:new Uint8Array(await file.arrayBuffer()),replace:{...input,nodeId:id}}));
}catch(error){return documentErrorResponse(error);}}
