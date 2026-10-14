import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, teams, projects, taskChecklistItems as items } from "@/db/schema";
import { requireUser, requireProjectAccess, parseId, parseBody, ApiError, handleApiError } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };
const title = z.string().trim().min(1, "请填写清单内容").max(200, "清单内容最多 200 个字");
const createSchema = z.object({ title });
const updateSchema = z.object({
  itemId: z.number().int().positive(), title: title.optional(), completed: z.boolean().optional(),
}).refine((body) => body.title !== undefined || body.completed !== undefined, "请提供要修改的内容");
const deleteSchema = z.object({ itemId: z.number().int().positive() });

async function access(request: Request, context: Context) {
  const user = await requireUser(request);
  const taskId = parseId((await context.params).id, "任务 ID");
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new ApiError(404, "任务不存在");
  const { project } = await requireProjectAccess(user.id, task.projectId);
  return { user, taskId, project };
}

export async function GET(request: Request, context: Context) {
  try {
    const { taskId } = await access(request, context);
    return Response.json({ items: await db.select().from(items).where(eq(items.taskId, taskId)).orderBy(items.id) });
  } catch (error) { return handleApiError(error); }
}

async function mutate(request: Request, context: Context, operation: "create" | "update" | "delete") {
  try {
    const { user, taskId, project } = await access(request, context);
    const body = operation === "create" ? await parseBody(request, createSchema)
      : operation === "update" ? await parseBody(request, updateSchema) : await parseBody(request, deleteSchema);
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      await requireProjectAccess(user.id, project.id, "member", tx);
      const [task] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).for("update");
      if (!task) throw new ApiError(404, "任务不存在");
      if (operation === "create") {
        const existing = await tx.select({ id: items.id }).from(items).where(eq(items.taskId, taskId));
        if (existing.length >= 50) throw new ApiError(400, "每个任务最多 50 个清单步骤");
        const [item] = await tx.insert(items).values({ taskId, title: (body as z.infer<typeof createSchema>).title }).returning();
        return { item };
      }
      const input = body as z.infer<typeof updateSchema>;
      const where = and(eq(items.taskId, taskId), eq(items.id, input.itemId));
      if (operation === "delete") {
        const deleted = await tx.delete(items).where(where).returning({ id: items.id });
        if (!deleted.length) throw new ApiError(404, "清单步骤不存在");
        return { ok: true };
      }
      const [item] = await tx.update(items).set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
      }).where(where).returning();
      if (!item) throw new ApiError(404, "清单步骤不存在");
      return { item };
    });
    return Response.json(result, { status: operation === "create" ? 201 : 200 });
  } catch (error) { return handleApiError(error); }
}

export const POST = (request: Request, context: Context) => mutate(request, context, "create");
export const PUT = (request: Request, context: Context) => mutate(request, context, "update");
export const DELETE = (request: Request, context: Context) => mutate(request, context, "delete");
