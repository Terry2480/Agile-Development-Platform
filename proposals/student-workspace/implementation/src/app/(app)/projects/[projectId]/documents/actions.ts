"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createDocument, deleteDocument, updateDocument } from "@/lib/document";
import { AppError, ForbiddenError } from "@/lib/errors";

export type DocumentActionState =
  | { error: string }
  | { ok: true; id?: string }
  | null;

const createSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写文档标题"),
  kind: z.enum(["custom", "proposal", "meeting", "weekly", "research"]),
});

export async function createDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const document = await createDocument(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      kind: parsed.data.kind,
    });
    revalidatePath(`/projects/${parsed.data.projectId}`);
    revalidatePath(`/projects/${parsed.data.projectId}/documents`);
    return { ok: true, id: document.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限创建文档" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

const updateSchema = z.object({
  projectId: z.uuid(),
  documentId: z.uuid(),
  title: z.string().trim().min(1, "文档标题不能为空"),
  content: z.string(),
});

export async function updateDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateDocument(session.user.id, parsed.data.documentId, {
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      content: parsed.data.content,
    });
    revalidatePath(`/projects/${parsed.data.projectId}`);
    revalidatePath(`/projects/${parsed.data.projectId}/documents`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限修改文档" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

const deleteSchema = z.object({
  projectId: z.uuid(),
  documentId: z.uuid(),
});

export async function deleteDocumentAction(
  _prev: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  try {
    await deleteDocument(session.user.id, parsed.data.projectId, parsed.data.documentId);
    revalidatePath(`/projects/${parsed.data.projectId}`);
    revalidatePath(`/projects/${parsed.data.projectId}/documents`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除文档" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}
