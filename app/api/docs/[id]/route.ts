import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { docs } from "@/db/schema";
import { requireUser, parseBody, parseId, ApiError, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { MAX_DOC_CONTENT_CHARS, shouldSnapshotDoc } from "@/lib/docs";
import { loadDocDetail, snapshotAndPrune } from "@/lib/docs-access";

// 单篇文档：详情 / 保存（带历史快照）/ 删除
// GET    /api/docs/[id]                → 文档全文（项目成员可读）
// PUT    /api/docs/[id] { title?, content? } → 保存；内容变化时先快照旧版本（每篇保留最近 20 版）
// DELETE /api/docs/[id]                → 删除（创建者或团队 admin/owner）

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    const { detail } = await loadDocDetail(user.id, docId);
    return Response.json({ doc: detail });
  } catch (error) {
    return handleApiError(error);
  }
}

const saveSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(80, "标题最长 80 字").optional(),
  content: z.string().max(MAX_DOC_CONTENT_CHARS, "文档内容过长").optional(),
  folder: z.string().trim().max(30, "分组名最长 30 字").optional().nullable(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    const { doc } = await loadDocDetail(user.id, docId);
    const body = await parseBody(request, saveSchema);

    // 内容/标题变更才生成历史快照；仅改分组不快照但更新时间
    const contentChanged = shouldSnapshotDoc({ title: doc.title, content: doc.content }, body);
    const folderChanged = body.folder !== undefined && (body.folder || null) !== (doc.folder ?? null);
    if (contentChanged || folderChanged) {
      if (contentChanged) {
        await snapshotAndPrune(docId, { title: doc.title, content: doc.content }, user.id);
      }
      await db
        .update(docs)
        .set({
          title: body.title ?? doc.title,
          content: body.content ?? doc.content,
          ...(body.folder !== undefined ? { folder: body.folder || null } : {}),
          updatedById: user.id,
          updatedAt: new Date(),
        })
        .where(eq(docs.id, docId));
    }

    const { detail } = await loadDocDetail(user.id, docId);
    return Response.json({ doc: detail });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    const { doc, detail } = await loadDocDetail(user.id, docId);
    if (!detail.canDelete) throw new ApiError(403, "只有文档创建者和管理员可以删除文档");

    await db.delete(docs).where(eq(docs.id, docId));
    await logActivity({
      projectId: doc.projectId,
      actorId: user.id,
      action: "doc.deleted",
      detail: `${displayName(user)} 删除了文档《${doc.title}》`,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
