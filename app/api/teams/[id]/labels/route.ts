import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { labels } from "@/db/schema";
import { requireUser, parseBody, parseId, requireTeamAccess, handleApiError } from "@/lib/api";

// 团队标签：GET /api/teams/[id]/labels 列表；POST 新建（团队内名称唯一）
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    await requireTeamAccess(user.id, teamId);

    const rows = await db.select().from(labels).where(eq(labels.teamId, teamId)).orderBy(labels.createdAt);
    return Response.json({ labels: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写标签名").max(20, "标签名过长"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确（如 #3b6ef5）")
    .default("#3b6ef5"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    await requireTeamAccess(user.id, teamId);
    const body = await parseBody(request, createSchema);

    try {
      const [label] = await db
        .insert(labels)
        .values({ teamId, name: body.name, color: body.color })
        .returning();
      return Response.json({ label }, { status: 201 });
    } catch (error) {
      // Postgres 唯一约束冲突（23505）：Drizzle 会把原始错误包在 cause 里（与 lib/api.ts 同款判断）
      const pgError = error as { cause?: { code?: string }; code?: string };
      if (pgError?.cause?.code === "23505" || pgError?.code === "23505") {
        return Response.json({ error: "该标签名已存在" }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
