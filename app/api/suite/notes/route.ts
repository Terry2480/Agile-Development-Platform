import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { personalNotes } from "@/db/schema";
import { requireUser, parseBody, ApiError, handleApiError } from "@/lib/api";

// 个人记事（Keep 风格，按用户隔离）：
// GET  /api/suite/notes            → 我的记事（置顶在前，再按更新时间）
// POST /api/suite/notes            → 新建
// PUT  /api/suite/notes            → 更新（body 带 id）
// DELETE /api/suite/notes?id=      → 删除
const COLORS = ["yellow", "blue", "green", "pink", "purple"] as const;
const createSchema = z.object({
  title: z.string().trim().max(120, "标题过长").optional().default(""),
  content: z.string().max(5000, "内容过长").optional().default(""),
  color: z.enum(COLORS).optional().default("yellow"),
  pinned: z.boolean().optional().default(false),
});
const updateSchema = z.object({
  id: z.number().int().positive("ID 不合法"),
  title: z.string().trim().max(120, "标题过长").optional(),
  content: z.string().max(5000, "内容过长").optional(),
  color: z.enum(COLORS).optional(),
  pinned: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await db.select().from(personalNotes)
      .where(eq(personalNotes.userId, user.id))
      .orderBy(desc(personalNotes.pinned), desc(personalNotes.updatedAt))
      .limit(500);
    return Response.json({ notes: rows });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);
    const [row] = await db.insert(personalNotes).values({
      userId: user.id, title: body.title, content: body.content, color: body.color, pinned: body.pinned,
    }).returning();
    return Response.json({ note: row }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, updateSchema);
    const [existing] = await db.select().from(personalNotes)
      .where(and(eq(personalNotes.id, body.id), eq(personalNotes.userId, user.id))).limit(1);
    if (!existing) throw new ApiError(404, "记事不存在");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ["title", "content", "color", "pinned"] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const [row] = await db.update(personalNotes).set(patch)
      .where(and(eq(personalNotes.id, body.id), eq(personalNotes.userId, user.id))).returning();
    return Response.json({ note: row });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "ID 不合法");
    const deleted = await db.delete(personalNotes)
      .where(and(eq(personalNotes.id, id), eq(personalNotes.userId, user.id))).returning({ id: personalNotes.id });
    if (deleted.length === 0) throw new ApiError(404, "记事不存在");
    return Response.json({ ok: true });
  } catch (error) { return handleApiError(error); }
}
