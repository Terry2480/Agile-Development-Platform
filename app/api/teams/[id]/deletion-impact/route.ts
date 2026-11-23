import {withDocumentUser,documentId} from "@/lib/documents/http";
import {documentsEnabled,createDocumentLifecycle} from "@/lib/documents/lifecycle";
import {DocumentError} from "@/lib/documents/errors";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return withDocumentUser(request,async actor=>{if(!await documentsEnabled())throw new DocumentError(503,"DOCUMENTS_NOT_READY","文档迁移尚未切换");return createDocumentLifecycle().impact(actor,"team",documentId((await params).id));});}
