import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams, users, teamMembers, projects, projectMembers } from "@/db/schema";
import { requireUser, parseBody, parseId, requireTeamAccess, ApiError, handleApiError } from "@/lib/api";

// 添加成员：POST /api/teams/[id]/members  { email, role? }
// 按邮箱查找已注册用户加入团队，并同步加入该团队的全部项目（项目成员保持与团队一致）
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const teamId = parseId((await params).id, "团队 ID");
    await requireTeamAccess(user.id, teamId, "admin");

    const body = await parseBody(
      request,
      z.object({
        email: z.string().trim().email("请填写正确的邮箱"),
        role: z.enum(["admin", "member"]).default("member"),
      }),
    );

    const [target] = await db
      .select({ id: users.id, email: users.email, name: users.name, studentId: users.studentId })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (!target) throw new ApiError(404, "该邮箱尚未注册，请对方先注册账号");

    await db.transaction(async (tx) => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
      await requireTeamAccess(user.id, teamId, "admin", tx);
      // 加入和项目同步一起提交；团队锁串行化同一团队的成员变更。
      const dup = await tx
        .select({ id: teamMembers.id, userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      if (dup.some((m) => m.userId === target.id)) {
        throw new ApiError(409, "该用户已是团队成员");
      }

      await tx.insert(teamMembers).values({ teamId, userId: target.id, role: body.role });

      // 同步加入该团队全部项目（已存在则忽略）
      const teamProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.teamId, teamId));
      if (teamProjects.length > 0) {
        await tx
          .insert(projectMembers)
          .values(teamProjects.map((p) => ({ projectId: p.id, userId: target.id })))
          .onConflictDoNothing();
      }
    });

    return Response.json({ member: { userId: target.id, email: target.email, name: target.name, studentId: target.studentId, role: body.role } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
