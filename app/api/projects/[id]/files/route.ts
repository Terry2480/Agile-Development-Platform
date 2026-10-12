import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, tasks, users, projects, teams, fileCleanup } from "@/db/schema";
import { uploadPath, tryFileCleanup } from "@/lib/file-cleanup";
import { requireUser, parseId, requireProjectAccess, ApiError, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE } from "@/lib/upload-limits";

// 项目文件：GET /api/projects/[id]/files?taskId=  文件列表（可不带 taskId 查项目全部）
//             POST multipart/form-data { file, taskId? }  上传（≤100MB，存本地 uploads/ 目录）
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const taskIdParam = new URL(request.url).searchParams.get("taskId");
    const taskId = taskIdParam === null ? null : parseId(taskIdParam, "任务 ID");
    if (taskId !== null) {
      const [task] = await db.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.id, taskId))).limit(1);
      if (!task) throw new ApiError(404, "关联任务不存在");
    }

    const rows = await db
      .select({
        id: attachments.id,
        uploaderId: attachments.uploaderId,
        taskId: attachments.taskId,
        originalName: attachments.originalName,
        mimeType: attachments.mimeType,
        size: attachments.size,
        createdAt: attachments.createdAt,
        uploaderName: users.name,
        uploaderStudentId: users.studentId,
      })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploaderId))
      .where(and(eq(attachments.projectId, projectId), taskId !== null ? eq(attachments.taskId, taskId) : undefined))
      .orderBy(desc(attachments.createdAt));

    return Response.json({ files: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let pendingStoredName: string | null = null;
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId);

    const form = await request.formData().catch((error: unknown) => {
      console.error("[file-upload] 上传表单解析失败", error);
      throw new ApiError(400, "上传内容无法解析，可能未完整传输，请重新上传（文件不能超过 100MB）");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "请选择要上传的文件");
    if (file.size === 0) throw new ApiError(400, "文件为空");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, UPLOAD_LIMIT_MESSAGE);

    // 可选：挂到某个任务（校验任务属于本项目）
    let taskId: number | null = null;
    const taskIdRaw = form.get("taskId");
    if (taskIdRaw !== null) {
      if (typeof taskIdRaw !== "string") throw new ApiError(400, "任务 ID 不合法");
      taskId = parseId(taskIdRaw, "任务 ID");
      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task || task.projectId !== projectId) throw new ApiError(400, "关联任务不存在");
    }

    // 存储名用随机 UUID + 受控后缀，避免路径穿越与重名
    const ext = path.extname(file.name).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, "");
    const storedName = `${randomUUID()}${ext}`;
    // 先登记再写磁盘；崩溃后由队列清理。给正常上传保留一小时处理窗口。
    await db.insert(fileCleanup).values({ storedName, notBefore: new Date(Date.now() + 3600000) });
    pendingStoredName = storedName;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(uploadPath(storedName), Buffer.from(await file.arrayBuffer()), { flag: "wx" });

    const record = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("share");
      await requireProjectAccess(user.id, projectId, "member", tx);
      const [created] = await tx
        .insert(attachments)
        .values({
          projectId,
          taskId,
          uploaderId: user.id,
          originalName: file.name.slice(0, 200),
          storedName,
          mimeType: file.type || null,
          size: file.size,
        })
        .returning();

      await logActivity({
        projectId,
        taskId,
        actorId: user.id,
        action: "file.uploaded",
        detail: `${displayName(user)} 上传了文件 ${created.originalName}`,
      }, tx);
      await tx.delete(fileCleanup).where(eq(fileCleanup.storedName, storedName));
      return created;
    });
    pendingStoredName = null;

    return Response.json({ file: record }, { status: 201 });
  } catch (error) {
    if (pendingStoredName) {
      try {
        await db.update(fileCleanup).set({ notBefore: new Date() }).where(eq(fileCleanup.storedName, pendingStoredName));
        await tryFileCleanup();
      } catch { console.error("[file-upload] 清理已排队，等待后台重试"); }
    }
    return handleApiError(error);
  }
}
