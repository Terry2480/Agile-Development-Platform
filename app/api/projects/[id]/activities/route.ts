import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, users } from "@/db/schema";
import { requireUser, parseId, requireProjectAccess, handleApiError } from "@/lib/api";

// 项目日志：GET /api/projects/[id]/activities?limit=50  按时间倒序的活动流
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const search = new URL(request.url).searchParams;
    const requestedLimit = Number(search.get("limit")) || 50;
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 200)) : 50;
    const beforeId = search.get("beforeId");
    const cursorId = beforeId ? parseId(beforeId, "日志 ID") : null;

    const rows = await db
      .select({
        id: activities.id,
        action: activities.action,
        detail: activities.detail,
        taskId: activities.taskId,
        createdAt: activities.createdAt,
        actorName: users.name,
        actorStudentId: users.studentId,
      })
      .from(activities)
      .innerJoin(users, eq(users.id, activities.actorId))
      .where(and(
        eq(activities.projectId, projectId),
        // 在数据库内比较原始时间精度，避免同一毫秒内的日志在分页时遗漏。
        cursorId ? sql`(${activities.createdAt}, ${activities.id}) < (
          select created_at, id from activities where id = ${cursorId} and project_id = ${projectId}
        )` : undefined,
      ))
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(Number.isFinite(limit) ? limit : 50);

    return Response.json({ activities: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
