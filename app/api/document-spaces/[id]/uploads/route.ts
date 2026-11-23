import {requireUser} from "@/lib/api";
import {documentId} from "@/lib/documents/http";
import {documentErrorResponse,DocumentError} from "@/lib/documents/errors";
import {documentService} from "@/lib/documents/service";
import {uploadDocumentInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireUser(request);const spaceId=documentId((await params).id);
    // Check membership before parsing a potentially large multipart payload.
    const listing=await documentService.list(actor.id,spaceId,{parentId:null,q:"",sort:"name",limit:1,foldersOnly:false});
    if(listing.space.readOnly) throw new DocumentError(403,"READ_ONLY_SPACE","项目已归档，只能阅读");
    const length=Number(request.headers.get("content-length")??0);
    if(length>101*1024*1024) throw new DocumentError(413,"INVALID_FILE","单文件不能超过 100MB");
    const form=await request.formData().catch(()=>{throw new DocumentError(400,"INVALID_INPUT","上传表单无法解析，请重新选择文件");});
    if([...form.keys()].some(k=>!["file","parentId","requestId","taskId","milestoneId"].includes(k)) || ["file","parentId","requestId"].some(k=>form.getAll(k).length!==1)) throw new DocumentError(400,"INVALID_INPUT","上传表单不合法");
    const file=form.get("file");
    if(file instanceof File && file.size>100*1024*1024) throw new DocumentError(413,"INVALID_FILE","单文件不能超过 100MB");
    if(!(file instanceof File) || !file.size) throw new DocumentError(400,"INVALID_FILE","请选择非空且不超过 100MB 的文件");
    const input=uploadDocumentInput.parse({parentId:Number(form.get("parentId")),requestId:form.get("requestId"),...(form.has("taskId")?{taskId:Number(form.get("taskId"))}:{}),...(form.has("milestoneId")?{milestoneId:Number(form.get("milestoneId"))}:{})});
    const result=await documentService.upload(actor.id,spaceId,{...input,name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
    return Response.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return documentErrorResponse(error);}
}
