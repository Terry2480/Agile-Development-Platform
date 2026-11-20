import { and, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { teamMembers, teams, users } from "@/db/schema";
import { requireUser, handleApiError, displayName } from "@/lib/api";
import { memberOnline } from "@/lib/presence";

// 私聊联系人：我所有团队的其他成员（去重），在线优先、再按展示名排序
// GET /api/dm/contacts → [{ userId, displayName, teamName, teamCount, online }]
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const mine = alias(teamMembers, "mine");
    const peer = alias(teamMembers, "peer");

    const rows = await db
      .select({
        userId: users.id,
        name: users.name,
        studentId: users.studentId,
        teamName: sql<string | null>`(array_agg(${teams.name} order by ${teams.id}))[1]`,
        teamCount: sql<number>`count(distinct ${teams.id})::int`,
        online: memberOnline(users.id),
      })
      .from(mine)
      .innerJoin(peer, and(eq(peer.teamId, mine.teamId), ne(peer.userId, user.id)))
      .innerJoin(users, eq(users.id, peer.userId))
      .innerJoin(teams, eq(teams.id, peer.teamId))
      .where(eq(mine.userId, user.id))
      .groupBy(users.id)
      .orderBy(sql`${memberOnline(users.id)} desc`, sql`coalesce(${users.name}, ${users.studentId}) asc`)
      .limit(300);

    return Response.json({
      contacts: rows.map((r) => ({
        userId: r.userId,
        displayName: displayName(r),
        teamName: r.teamName,
        teamCount: r.teamCount,
        online: r.online,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
