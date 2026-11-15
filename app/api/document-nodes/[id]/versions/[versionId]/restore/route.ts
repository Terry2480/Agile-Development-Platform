import {parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {restoreVersionInput} from "@/lib/documents/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string;versionId:string}>}) {
 return withDocumentUser(request,async actor=>{const p=await params;return documentService.editor(actor,documentId(p.id),{...await parseBody(request,restoreVersionInput),action:"restore",versionId:documentId(p.versionId)});});
}
