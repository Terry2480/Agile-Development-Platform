import { parseBody } from "@/lib/api";
import { documentId, withDocumentUser } from "@/lib/documents/http";
import { documentService } from "@/lib/documents/service";
import { createNodeInput, listNodeInput } from "@/lib/documents/validation";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDocumentUser(request, async actor => documentService.list(actor, documentId((await params).id), listNodeInput(new URL(request.url).searchParams)));
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withDocumentUser(request, async actor => documentService.create(actor, documentId((await params).id), await parseBody(request, createNodeInput)), 201);
}
