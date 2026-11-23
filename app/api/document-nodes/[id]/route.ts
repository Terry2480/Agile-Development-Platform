import { parseBody } from "@/lib/api";
import { documentId, withDocumentUser } from "@/lib/documents/http";
import { documentService } from "@/lib/documents/service";
import { renameNodeInput } from "@/lib/documents/validation";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDocumentUser(request, async actor => documentService.detail(actor, documentId((await params).id),new URL(request.url).searchParams.get("trash")==="1"));
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDocumentUser(request, async actor => documentService.rename(actor, documentId((await params).id), await parseBody(request, renameNodeInput)));
}
