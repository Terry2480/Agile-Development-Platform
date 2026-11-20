import { z } from "zod";
import { eq, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { teams, teamMembers, projects } from "@/db/schema";
import { requireUser, parseBody, handleApiError } from "@/lib/api";

// 团队接口：GET /api/teams  我的团队列表（含成员数 / 项目数 / 我的角色）
//           POST /api/teams 新建团队（创建者自动成为 owner）
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    const rows = await db
      .select({ team: teams, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id))
      .orderBy(desc(teams.createdAt));

    const teamIds = rows.map((r) => r.team.id);
    let memberCounts: { teamId: number }[] = [];
    let projectCounts: { teamId: number }[] = [];
    if (teamIds.length > 0) {
      memberCounts = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, teamIds));
      projectCounts = await db
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(inArray(projects.teamId, teamIds));
    }

    const result = rows.map((r) => ({
      id: r.team.id,
      name: r.team.name,
      description: r.team.description,
      role: r.role,
      memberCount: memberCounts.filter((m) => m.teamId === r.team.id).length,
      projectCount: projectCounts.filter((p) => p.teamId === r.team.id).length,
      createdAt: r.team.createdAt,
    }));
    return Response.json({ teams: result });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写团队名称").max(50, "团队名称过长"),
  description: z.string().trim().max(200, "团队简介过长").optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await parseBody(request, createSchema);

    const [team] = await db
      .insert(teams)
      .values({
        name: body.name,
        description: body.description || null,
        ownerId: user.id,
      })
      .returning();

    await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "owner" });

    return Response.json({ team }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
