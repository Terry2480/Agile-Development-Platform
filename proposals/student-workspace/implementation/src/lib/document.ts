import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectDocuments, type DocumentKind } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { getDocumentTemplate } from "./document-templates";

type DocumentInput = {
  title: string;
  kind?: DocumentKind;
  content?: string;
};

async function requireDocumentAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

function canWrite(role: string) {
  return role === "admin" || role === "student";
}

export async function listProjectDocuments(actorId: string, projectId: string) {
  await requireDocumentAccess(actorId, projectId);
  return db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(desc(projectDocuments.updatedAt));
}

export async function createDocument(
  actorId: string,
  projectId: string,
  input: DocumentInput,
) {
  const access = await requireDocumentAccess(actorId, projectId);
  if (!canWrite(access.role)) throw new ForbiddenError();

  const title = input.title.trim();
  if (!title) throw new AppError("文档标题不能为空");
  const kind = input.kind ?? "custom";

  const [document] = await db
    .insert(projectDocuments)
    .values({
      projectId,
      title,
      kind,
      content: input.content ?? getDocumentTemplate(kind),
      createdById: actorId,
      updatedById: actorId,
    })
    .returning();
  return document;
}

export async function updateDocument(
  actorId: string,
  documentId: string,
  input: { projectId: string; title: string; content: string },
) {
  const access = await requireDocumentAccess(actorId, input.projectId);
  if (!canWrite(access.role)) throw new ForbiddenError();

  const title = input.title.trim();
  if (!title) throw new AppError("文档标题不能为空");

  const [document] = await db
    .update(projectDocuments)
    .set({
      title,
      content: input.content,
      updatedById: actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectDocuments.id, documentId),
        eq(projectDocuments.projectId, input.projectId),
      ),
    )
    .returning();
  if (!document) throw new AppError("文档不存在");
  return document;
}

export async function deleteDocument(
  actorId: string,
  projectId: string,
  documentId: string,
) {
  const access = await requireDocumentAccess(actorId, projectId);
  if (!canWrite(access.role)) throw new ForbiddenError();

  const [deleted] = await db
    .delete(projectDocuments)
    .where(
      and(
        eq(projectDocuments.id, documentId),
        eq(projectDocuments.projectId, projectId),
      ),
    )
    .returning({ id: projectDocuments.id });
  if (!deleted) throw new AppError("文档不存在");
  return deleted;
}
