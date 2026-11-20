import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { labels } from "@/db/schema";
import { requireUser, parseBody, parseId, requireTeamAccess, ApiError, handleApiError } from "@/lib/api";

// 单个标签：PUT /api/labels/[id] 改名改色；DELETE 删除（任务关联级联清除）
async function requireLabelTeam(userId: number, labelId: number) {
  const [label] = await db.select().from(labels).where(eq(labels.id, labelId)).limit(1);
  if (!label) throw new ApiError(404, "标签不存在");
  await requireTeamAccess(userId, label.teamId, "admin");
  return label;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const labelId = parseId((await params).id, "标签 ID");
    const label = await requireLabelTeam(user.id, labelId);

    const body = await parseBody(
      request,
      z.object({
        name: z.string().trim().min(1, "请填写标签名").max(20, "标签名过长").optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确").optional(),
      }),
    );

    const [updated] = await db
      .update(labels)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      })
      .where(eq(labels.id, label.id))
      .returning();
    return Response.json({ label: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const labelId = parseId((await params).id, "标签 ID");
    const label = await requireLabelTeam(user.id, labelId);

    await db.delete(labels).where(eq(labels.id, label.id));
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
