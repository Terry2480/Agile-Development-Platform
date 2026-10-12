import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, teams, fileCleanup } from "@/db/schema";
import { tryFileCleanup } from "@/lib/file-cleanup";
import { logActivity } from "@/lib/activity";
import { requireUser, parseId, requireProjectAccess, ApiError, handleApiError } from "@/lib/api";

// 文件下载：GET /api/files/[id]  校验团队成员身份后回传文件流（原始文件名展示）
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const fileId = parseId((await params).id, "文件 ID");
    const [record] = await db.select().from(attachments).where(eq(attachments.id, fileId)).limit(1);
    if (!record) throw new ApiError(404, "文件不存在或已撤回");
    const { project } = await requireProjectAccess(user.id, record.projectId);
    await db.transaction(async (tx) => {
      // 与成员权限变更使用同一个团队锁，避免校验后权限被撤销。
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      const { membership } = await requireProjectAccess(user.id, record.projectId, "member", tx);
      const [current] = await tx.select().from(attachments).where(eq(attachments.id, fileId)).for("update");
      if (!current) throw new ApiError(404, "文件不存在或已撤回");
      if (current.uploaderId !== user.id && !["owner", "admin"].includes(membership.role)) {
        throw new ApiError(403, "只能撤回自己上传的文件，团队负责人或管理员可以撤回团队文件");
      }
      await tx.insert(fileCleanup).values({ storedName: current.storedName }).onConflictDoNothing();
      await tx.delete(attachments).where(eq(attachments.id, fileId));
      await logActivity({ projectId: current.projectId, taskId: current.taskId, actorId: user.id,
        action: "file.deleted", detail: `${user.name || user.studentId} 撤回了文件 ${current.originalName}` }, tx);
    });
    await tryFileCleanup();
    return Response.json({ success: true });
  } catch (error) { return handleApiError(error); }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const fileId = parseId((await params).id, "文件 ID");

    const [record] = await db.select().from(attachments).where(eq(attachments.id, fileId)).limit(1);
    if (!record) throw new ApiError(404, "文件不存在");
    await requireProjectAccess(user.id, record.projectId);

    const buffer = await readFile(path.join(UPLOAD_DIR, record.storedName)).catch(() => {
      throw new ApiError(404, "文件已丢失");
    });

    // 文件名含中文时用 RFC 5987 编码，保证下载名正确
    const encodedName = encodeURIComponent(record.originalName);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": record.mimeType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
