import {requireUser,parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentErrorResponse,DocumentError} from "@/lib/documents/errors";
import {documentService} from "@/lib/documents/service";
import {imageUploadInput,imageGrantInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const actor=await requireUser(request);const id=documentId((await params).id);
 await documentService.detail(actor.id,id);
 const form=await request.formData().catch(()=>{throw new DocumentError(400,"INVALID_IMAGE","图片上传表单无法解析");});const file=form.get("file");
 if(!(file instanceof File)||!file.size||file.size>10485760)throw new DocumentError(400,"INVALID_IMAGE","请选择不超过 10MB 的 JPG、PNG 或 WebP");
 const input=imageUploadInput.parse({lockToken:form.get("lockToken"),requestId:form.get("requestId")});
 return Response.json(await documentService.imageUpload(actor.id,id,{...input,name:file.name,bytes:new Uint8Array(await file.arrayBuffer())}),{status:201,headers:{"Cache-Control":"private, no-store"}});
}catch(error){return documentErrorResponse(error);}}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){return withDocumentUser(request,async actor=>documentService.imageGrant(actor,documentId((await params).id),await parseBody(request,imageGrantInput)));}
