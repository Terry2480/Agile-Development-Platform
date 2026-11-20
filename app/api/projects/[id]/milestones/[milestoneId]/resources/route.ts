import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, milestoneResources as resources, attachments, projects, teams, users } from "@/db/schema";
import { requireUser, requireProjectAccess, parseId, parseBody, ApiError, handleApiError, displayName } from "@/lib/api";

type Context = { params: Promise<{ id: string; milestoneId: string }> };
const link = z.string().trim().url("请填写完整链接").max(2000).refine((url) => {
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}, "仅支持 http 或 https 链接");
const createSchema = z.union([
  z.object({ attachmentId: z.number().int().positive() }).strict(),
  z.object({ title: z.string().trim().min(1, "请填写成果名称").max(200), url: link }).strict(),
]);
async function access(request: Request, context: Context) {
  const user = await requireUser(request);
  const params = await context.params;
  const projectId = parseId(params.id, "项目 ID");
  const milestoneId = parseId(params.milestoneId, "里程碑 ID");
  const { project } = await requireProjectAccess(user.id, projectId);
  const [milestone] = await db.select({ id: milestones.id }).from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId))).limit(1);
  if (!milestone) throw new ApiError(404, "里程碑不存在");
  return { user, project, milestoneId };
}
export async function GET(request: Request, context: Context) {
  try {
    const { milestoneId } = await access(request, context);
    const rows = await db.select({ id: resources.id, title: resources.title, url: resources.url,
      attachmentId: resources.attachmentId, createdById: resources.createdById, createdAt: resources.createdAt,
      size: attachments.size, name: users.name, studentId: users.studentId })
      .from(resources).leftJoin(attachments, eq(attachments.id, resources.attachmentId))
      .leftJoin(users, eq(users.id, resources.createdById)).where(eq(resources.milestoneId, milestoneId)).orderBy(resources.id);
    return Response.json({ resources: rows.map(({ name, studentId, ...row }) => ({ ...row, author: name || studentId ? displayName({ name, studentId: studentId ?? "" }) : "未知成员" })) });
  } catch (error) { return handleApiError(error); }
}
async function mutate(request: Request, context: Context, deleting: boolean) {
  try {
    const { user, project, milestoneId } = await access(request, context);
    const body = deleting ? await parseBody(request, z.object({ resourceId: z.number().int().positive() }).strict()) : await parseBody(request, createSchema);
    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("share");
      const { membership } = await requireProjectAccess(user.id, project.id, "member", tx);
      const [milestone] = await tx.select({ id: milestones.id }).from(milestones)
        .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, project.id))).for("update");
      if (!milestone) throw new ApiError(404, "里程碑不存在");
      if ("resourceId" in body) {
        const [row] = await tx.select().from(resources).where(and(eq(resources.id, body.resourceId), eq(resources.milestoneId, milestoneId)));
        if (!row) throw new ApiError(404, "成果不存在");
        if (row.createdById !== user.id && !["owner", "admin"].includes(membership.role)) throw new ApiError(403, "只能移除自己添加的成果");
        await tx.delete(resources).where(eq(resources.id, row.id));
      } else if ("attachmentId" in body) {
        const [file] = await tx.select().from(attachments).where(and(eq(attachments.id, body.attachmentId), eq(attachments.projectId, project.id))).for("key share");
        if (!file) throw new ApiError(400, "文件必须属于当前项目");
        await tx.insert(resources).values({ milestoneId, attachmentId: file.id, title: file.originalName, createdById: user.id });
      } else await tx.insert(resources).values({ milestoneId, title: body.title, url: body.url, createdById: user.id });
    });
    return Response.json({ ok: true }, { status: deleting ? 200 : 201 });
  } catch (error) { return handleApiError(error); }
}
export const POST = (request: Request, context: Context) => mutate(request, context, false);
export const DELETE = (request: Request, context: Context) => mutate(request, context, true);
