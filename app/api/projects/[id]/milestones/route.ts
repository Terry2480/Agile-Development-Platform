import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { milestones, milestoneTasks, tasks } from "@/db/schema";
import { requireUser, requireProjectAccess, parseId, parseBody, ApiError, handleApiError } from "@/lib/api";
import { milestoneSchema } from "@/lib/milestones";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id);
    await requireProjectAccess(user.id, projectId);
    const rows = await db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(milestones.dueOn, milestones.id);
    const links = rows.length ? await db.select().from(milestoneTasks).where(inArray(milestoneTasks.milestoneId, rows.map((m) => m.id))) : [];
    return Response.json({ milestones: rows.map((m) => ({ ...m, taskIds: links.filter((l) => l.milestoneId === m.id).map((l) => l.taskId) })) });
  } catch (e) { return handleApiError(e); }
}

async function mutate(request: Request, { params }: Context, mode: "create" | "update" | "delete") {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id);
    await requireProjectAccess(user.id, projectId, "admin");
    const milestoneId = mode === "create" ? null : parseId(new URL(request.url).searchParams.get("milestoneId") ?? undefined, "里程碑 ID");
    const body = mode === "delete" ? null : await parseBody(request, milestoneSchema);
    await db.transaction(async (tx) => {
      if (milestoneId) {
        const [row] = await tx.select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId))).for("update");
        if (!row) throw new ApiError(404, "里程碑不存在");
        if (mode === "delete") { await tx.delete(milestones).where(eq(milestones.id, milestoneId)); return; }
      }
      if (!body) return;
      if (body.taskIds.length) {
        const valid = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, projectId), inArray(tasks.id, body.taskIds))).for("key share");
        if (valid.length !== body.taskIds.length) throw new ApiError(400, "关联任务必须属于当前项目");
      }
      const { taskIds, ...values } = body;
      const [row] = milestoneId
        ? await tx.update(milestones).set(values).where(eq(milestones.id, milestoneId)).returning()
        : await tx.insert(milestones).values({ ...values, projectId }).returning();
      await tx.delete(milestoneTasks).where(eq(milestoneTasks.milestoneId, row.id));
      if (taskIds.length) await tx.insert(milestoneTasks).values(taskIds.map((taskId) => ({ milestoneId: row.id, taskId })));
    });
    return Response.json({ ok: true }, { status: mode === "create" ? 201 : 200 });
  } catch (e) { return handleApiError(e); }
}

export const POST = (request: Request, context: Context) => mutate(request, context, "create");
export const PUT = (request: Request, context: Context) => mutate(request, context, "update");
export const DELETE = (request: Request, context: Context) => mutate(request, context, "delete");
