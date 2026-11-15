import {parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {linkUpdateInput} from "@/lib/documents/validation";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){return withDocumentUser(request,async actor=>documentService.updateLink(actor,documentId((await params).id),await parseBody(request,linkUpdateInput)));}
