import {parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {moveNodeInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 return withDocumentUser(request,async actor=>documentService.copy(actor,documentId((await params).id),await parseBody(request,moveNodeInput)));
}
