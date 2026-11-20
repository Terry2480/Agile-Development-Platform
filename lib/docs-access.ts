import { asc, eq, inArray, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { docVersions, docs, projects, teamMembers, users } from "@/db/schema";
import { ApiError, displayName, roleAtLeast } from "@/lib/api";
import { docExcerpt, pruneVersionIds } from "@/lib/docs";

/* 云文档服务层：详情组装（含权限校验）与版本快照。供 /api/docs 系列路由共用 */

const updater = alias(users, "updater");
const creator = alias(users, "creator");

// 载入文档 + 当前用户的团队成员身份；无权限时与不存在同样返回 404（不泄露文档存在性）
// 返回 { doc 行, role, detail(前端结构) }
export async function loadDocDetail(userId: number, docId: number) {
  const [row] = await db
    .select({
      doc: docs,
      projectName: projects.name,
      updatedByName: updater.name,
      updatedByStudentId: updater.studentId,
      createdByName: creator.name,
      createdByStudentId: creator.studentId,
      membership: teamMembers,
    })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, userId)))
    .leftJoin(updater, eq(updater.id, docs.updatedById))
    .leftJoin(creator, eq(creator.id, docs.createdById))
    .where(eq(docs.id, docId))
    .limit(1);
  if (!row) throw new ApiError(404, "文档不存在或你没有访问权限");
  const { doc, membership, ...rest } = row;
  return {
    doc,
    role: membership.role,
    detail: {
      id: doc.id,
      projectId: doc.projectId,
      projectName: rest.projectName,
      title: doc.title,
      content: doc.content,
      folder: doc.folder ?? null,
      excerpt: docExcerpt(doc.content),
      createdByName: rest.createdByStudentId
        ? displayName({ name: rest.createdByName, studentId: rest.createdByStudentId })
        : null,
      updatedByName: rest.updatedByStudentId
        ? displayName({ name: rest.updatedByName, studentId: rest.updatedByStudentId })
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      canDelete: doc.createdById === userId || roleAtLeast(membership.role, "admin"),
      canEdit: true,
    },
  };
}

// 保存旧内容快照，并把版本数量收敛到保留窗口内（删除最旧的溢出部分）
export async function snapshotAndPrune(docId: number, previous: { title: string; content: string }, editorId: number) {
  await db.insert(docVersions).values({
    docId,
    title: previous.title,
    content: previous.content,
    editorId,
  });
  const all = await db
    .select({ id: docVersions.id })
    .from(docVersions)
    .where(eq(docVersions.docId, docId))
    .orderBy(asc(docVersions.id));
  const drop = pruneVersionIds(all);
  if (drop.length > 0) {
    await db.delete(docVersions).where(inArray(docVersions.id, drop));
  }
}
