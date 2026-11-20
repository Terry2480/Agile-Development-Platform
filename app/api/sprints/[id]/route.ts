import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sprints } from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// 编辑 / 启动 / 完成 Sprint：PUT /api/sprints/[id]
// status 置为 active 时自动停用同项目其他活跃迭代
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const sprintId = parseId((await params).id, "迭代 ID");

    const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1);
    if (!sprint) throw new ApiError(404, "迭代不存在");
    const { projectId } = sprint;
    await requireProjectAccess(user.id, projectId);

    const body = await parseBody(
      request,
      z.object({
        name: z.string().trim().min(1, "请填写迭代名称").max(50).optional(),
        goal: z.string().trim().max(200, "迭代目标过长").optional().nullable(),
        startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional(),
        endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional(),
        status: z.enum(["planned", "active", "completed"]).optional(),
      }),
    );

    if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) {
      return Response.json({ error: "交付日期不能早于开始日期" }, { status: 400 });
    }

    if (body.status === "active" && sprint.status !== "active") {
      await db
        .update(sprints)
        .set({ status: "planned" })
        .where(and(eq(sprints.projectId, projectId), eq(sprints.status, "active")));
    }

    const [updated] = await db
      .update(sprints)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.goal !== undefined ? { goal: body.goal || null } : {}),
        ...(body.startsOn !== undefined ? { startsOn: body.startsOn } : {}),
        ...(body.endsOn !== undefined ? { endsOn: body.endsOn } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(eq(sprints.id, sprintId))
      .returning();

    if (body.status && body.status !== sprint.status) {
      const actionText =
        body.status === "active" ? "启动了迭代" : body.status === "completed" ? "完成了迭代" : "重启了迭代";
      await logActivity({
        projectId,
        actorId: user.id,
        action: `sprint.${body.status}`,
        detail: `${displayName(user)} ${actionText} ${updated.name}`,
      });
    }

    return Response.json({ sprint: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
