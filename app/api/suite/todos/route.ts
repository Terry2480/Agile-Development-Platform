import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { personalTodos } from "@/db/schema";
import { requireUser, parseBody, ApiError, handleApiError } from "@/lib/api";

// 个人待办（不依赖项目，按用户隔离）：
// GET  /api/suite/todos            → 我的待办（未完成在前，再按截止日、创建时间）
// POST /api/suite/todos            → 新建
// PUT  /api/suite/todos            → 更新（body 带 id）
// DELETE /api/suite/todos?id=      → 删除
const createSchema = z.object({
  title: z.string().trim().min(1, "请填写待办标题").max(200, "标题过长"),
  note: z.string().max(1000, "备注过长").optional().nullable(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "截止日期格式应为 YYYY-MM-DD").optional().nullable(),
});
const updateSchema = z.object({
  id: z.number().int().positive("ID 不合法"),
  title: z.string().trim().min(1, "请填写待办标题").max(200, "标题过长").optional(),
  note: z.string().max(1000, "备注过长").optional().nullable(),
  done: z.boolean().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "截止日期格式应为 YYYY-MM-DD").optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await db.select().from(personalTodos)
      .where(eq(personalTodos.userId, user.id))
      .orderBy(asc(personalTodos.done), asc(personalTodos.dueOn), asc(personalTodos.createdAt))
      .limit(500);
    return Response.json({ todos: rows });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);
    const [row] = await db.insert(personalTodos).values({
      userId: user.id, title: body.title, note: body.note ?? null, dueOn: body.dueOn ?? null,
    }).returning();
    return Response.json({ todo: row }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, updateSchema);
    const [existing] = await db.select().from(personalTodos)
      .where(and(eq(personalTodos.id, body.id), eq(personalTodos.userId, user.id))).limit(1);
    if (!existing) throw new ApiError(404, "待办不存在");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.note !== undefined) patch.note = body.note;
    if (body.done !== undefined) patch.done = body.done;
    if (body.dueOn !== undefined) patch.dueOn = body.dueOn;
    const [row] = await db.update(personalTodos).set(patch)
      .where(and(eq(personalTodos.id, body.id), eq(personalTodos.userId, user.id))).returning();
    return Response.json({ todo: row });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "ID 不合法");
    const deleted = await db.delete(personalTodos)
      .where(and(eq(personalTodos.id, id), eq(personalTodos.userId, user.id))).returning({ id: personalTodos.id });
    if (deleted.length === 0) throw new ApiError(404, "待办不存在");
    return Response.json({ ok: true });
  } catch (error) { return handleApiError(error); }
}
