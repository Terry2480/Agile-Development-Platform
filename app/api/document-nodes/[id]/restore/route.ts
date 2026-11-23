import {parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {restoreTrashInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 return withDocumentUser(request,async actor=>documentService.restoreTrash(actor,documentId((await params).id),await parseBody(request,restoreTrashInput)));
}
