import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 return withDocumentUser(request,async actor=>documentService.versions(actor,documentId((await params).id)));
}
