import {parseBody} from "@/lib/api";
import {documentId,withDocumentUser} from "@/lib/documents/http";
import {documentService} from "@/lib/documents/service";
import {exportInput} from "@/lib/documents/validation";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return withDocumentUser(request,async actor=>{const cursor=new URL(request.url).searchParams.get("cursor");return documentService.exports(actor,documentId((await params).id),cursor?documentId(cursor):undefined);});}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return withDocumentUser(request,async actor=>documentService.createExport(actor,documentId((await params).id),await parseBody(request,exportInput)),202);}
