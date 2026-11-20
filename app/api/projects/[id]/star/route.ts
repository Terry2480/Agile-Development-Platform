import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectStars } from "@/db/schema";
import { requireUser, parseId, requireProjectAccess, handleApiError } from "@/lib/api";

// 收藏 / 取消收藏：POST /api/projects/[id]/star（切换，返回当前收藏状态）
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    await requireProjectAccess(user.id, projectId);

    const [existing] = await db
      .select({ id: projectStars.id })
      .from(projectStars)
      .where(and(eq(projectStars.projectId, projectId), eq(projectStars.userId, user.id)))
      .limit(1);

    if (existing) {
      await db.delete(projectStars).where(eq(projectStars.id, existing.id));
      return Response.json({ starred: false });
    }
    await db.insert(projectStars).values({ projectId, userId: user.id });
    return Response.json({ starred: true });
  } catch (error) {
    return handleApiError(error);
  }
}
