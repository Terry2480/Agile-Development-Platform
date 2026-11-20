import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { docs, projects, teamMembers, users } from "@/db/schema";
import { requireUser, parseBody, requireProjectAccess, handleApiError, displayName, roleAtLeast } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { docExcerpt, MAX_DOC_CONTENT_CHARS } from "@/lib/docs";

// 云文档列表 / 新建：
// GET  /api/docs?projectId=   → 我可访问的全部文档（可按项目过滤），按更新时间倒序
// POST /api/docs { projectId, title, content? } → 新建文档并写项目日志

const updater = alias(users, "updater");

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const projectIdRaw = new URL(request.url).searchParams.get("projectId");
    const projectId = projectIdRaw ? Number(projectIdRaw) : null;

    const baseQuery = db
      .select({
        id: docs.id,
        projectId: docs.projectId,
        projectName: projects.name,
        title: docs.title,
        content: docs.content,
        folder: docs.folder,
        updatedByName: updater.name,
        updatedByStudentId: updater.studentId,
        createdById: docs.createdById,
        myRole: teamMembers.role,
        updatedAt: docs.updatedAt,
      })
      .from(docs)
      .innerJoin(projects, eq(projects.id, docs.projectId))
      .innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, user.id)))
      .leftJoin(updater, eq(updater.id, docs.updatedById));

    const rows = await (Number.isInteger(projectId) && projectId! > 0
      ? baseQuery.where(eq(docs.projectId, projectId!))
      : baseQuery
    ).orderBy(desc(docs.updatedAt)).limit(300);

    return Response.json({
      docs: rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        projectName: row.projectName,
        title: row.title,
        folder: row.folder ?? null,
        excerpt: docExcerpt(row.content),
        updatedByName: row.updatedByName
          ? displayName({ name: row.updatedByName, studentId: row.updatedByStudentId! })
          : null,
        updatedAt: row.updatedAt,
        canDelete: row.createdById === user.id || roleAtLeast(row.myRole, "admin"),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  projectId: z.number({ message: "请选择项目" }).int().positive("请选择项目"),
  title: z.string().trim().min(1, "请填写文档标题").max(80, "标题最长 80 字"),
  content: z.string().max(MAX_DOC_CONTENT_CHARS, "文档内容过长").optional(),
  folder: z.string().trim().max(30, "分组名最长 30 字").optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);
    const { project } = await requireProjectAccess(user.id, body.projectId);

    const [doc] = await db
      .insert(docs)
      .values({
        projectId: body.projectId,
        title: body.title,
        content: body.content ?? "",
        folder: body.folder || null,
        createdById: user.id,
        updatedById: user.id,
      })
      .returning();

    await logActivity({
      projectId: body.projectId,
      actorId: user.id,
      action: "doc.created",
      detail: `${displayName(user)} 创建了文档《${body.title}》`,
    });

    return Response.json({
      doc: {
        id: doc.id,
        projectId: doc.projectId,
        projectName: project.name,
        title: doc.title,
        content: doc.content,
        folder: doc.folder ?? null,
        excerpt: docExcerpt(doc.content),
        createdByName: displayName(user),
        updatedByName: displayName(user),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        canDelete: true,
        canEdit: true,
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
