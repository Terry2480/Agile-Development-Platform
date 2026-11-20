import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { docVersions, docs, users } from "@/db/schema";
import { requireUser, parseBody, parseId, ApiError, handleApiError, displayName } from "@/lib/api";
import { docExcerpt } from "@/lib/docs";
import { loadDocDetail, snapshotAndPrune } from "@/lib/docs-access";

// 文档历史版本：
// GET  /api/docs/[id]/versions              → 版本列表（新→旧，含全文）
// POST /api/docs/[id]/versions { versionId } → 恢复到指定版本（当前内容先快照，恢复可撤销）

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    await loadDocDetail(user.id, docId); // 借详情校验访问权限

    const rows = await db
      .select({
        id: docVersions.id,
        title: docVersions.title,
        content: docVersions.content,
        createdAt: docVersions.createdAt,
        editorName: users.name,
        editorStudentId: users.studentId,
      })
      .from(docVersions)
      .leftJoin(users, eq(users.id, docVersions.editorId))
      .where(eq(docVersions.docId, docId))
      .orderBy(desc(docVersions.id))
      .limit(50);

    return Response.json({
      versions: rows.map((v) => ({
        id: v.id,
        title: v.title,
        excerpt: docExcerpt(v.content),
        content: v.content,
        editorName: v.editorStudentId
          ? displayName({ name: v.editorName, studentId: v.editorStudentId })
          : null,
        createdAt: v.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const restoreSchema = z.object({
  versionId: z.number({ message: "请选择要恢复的版本" }).int().positive("请选择要恢复的版本"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const docId = parseId((await params).id, "文档 ID");
    const { doc } = await loadDocDetail(user.id, docId);
    const { versionId } = await parseBody(request, restoreSchema);

    const [version] = await db
      .select()
      .from(docVersions)
      .where(and(eq(docVersions.id, versionId), eq(docVersions.docId, docId)))
      .limit(1);
    if (!version) throw new ApiError(404, "该版本不存在");

    // 恢复前先快照当前内容，保证「恢复」这个动作本身可以再撤销
    if (doc.title !== version.title || doc.content !== version.content) {
      await snapshotAndPrune(docId, { title: doc.title, content: doc.content }, user.id);
      await db
        .update(docs)
        .set({ title: version.title, content: version.content, updatedById: user.id, updatedAt: new Date() })
        .where(eq(docs.id, docId));
    }

    const { detail } = await loadDocDetail(user.id, docId);
    return Response.json({ doc: detail });
  } catch (error) {
    return handleApiError(error);
  }
}
