import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
export async function GET(request:Request,{params}:{params:Promise<{id:string;versionId:string}>}) {
 return withDocumentUser(request,async actor=>{const p=await params;return documentService.versions(actor,documentId(p.id),documentId(p.versionId));});
}
