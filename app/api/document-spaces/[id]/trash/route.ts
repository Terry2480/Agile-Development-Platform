import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 return withDocumentUser(request,async actor=>{const cursor=new URL(request.url).searchParams.get("cursor");return documentService.trashList(actor,documentId((await params).id),cursor?documentId(cursor):undefined);});
}
