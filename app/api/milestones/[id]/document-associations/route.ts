import { parseBody } from "@/lib/api";
import { documentId, withDocumentUser } from "@/lib/documents/http";
import { documentService } from "@/lib/documents/service";
import { associationInput } from "@/lib/documents/validation";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return withDocumentUser(request, async actor => documentService.associations(actor, "milestone", documentId((await params).id)));
}
export async function POST(request: Request, { params }: Context) {
  return withDocumentUser(request, async actor => documentService.associations(actor, "milestone", documentId((await params).id), await parseBody(request, associationInput)));
}
