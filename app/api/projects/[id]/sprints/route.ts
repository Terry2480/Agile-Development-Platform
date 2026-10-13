import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, teams, sprints } from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, ApiError, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { canManageDuties } from "@/lib/team-duties";

// Sprint 接口：GET /api/projects/[id]/sprints 全部迭代；POST 新建（status=active 时自动停用同项目其他活跃迭代）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const rows = await db
      .select()
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(sprints.createdAt);
    return Response.json({ sprints: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写迭代名称").max(50, "迭代名称过长"),
  goal: z.string().trim().max(200, "迭代目标过长").optional().nullable(),
  startsOn: dateStr,
  endsOn: dateStr,
  status: z.enum(["planned", "active", "completed"]).default("planned"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project, membership } = await requireProjectAccess(user.id, projectId);
    if (!canManageDuties(membership)) throw new ApiError(403, "只有负责人可以创建迭代");
    const body = await parseBody(request, createSchema);

    if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) {
      return Response.json({ error: "交付日期不能早于开始日期" }, { status: 400 });
    }

    const sprint = await db.transaction(async (tx) => {
      // 分工变更锁团队；创建迭代锁项目，检查与写入使用同一事务。
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, project.teamId)).for("share");
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
      const { membership: current } = await requireProjectAccess(user.id, projectId, "member", tx);
      if (!canManageDuties(current)) throw new ApiError(403, "只有负责人可以创建迭代");

      if (body.status === "active") {
        await tx.update(sprints).set({ status: "planned" })
          .where(and(eq(sprints.projectId, projectId), eq(sprints.status, "active")));
      }
      const [created] = await tx.insert(sprints).values({
        projectId, name: body.name, goal: body.goal || null,
        startsOn: body.startsOn ?? null, endsOn: body.endsOn ?? null, status: body.status,
      }).returning();
      await logActivity({
        projectId, actorId: user.id, action: "sprint.created",
        detail: `${displayName(user)} 创建了迭代 ${created.name}`,
      }, tx);
      return created;
    });

    return Response.json({ sprint }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
