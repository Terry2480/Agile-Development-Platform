import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers, teams, projects, tasks } from "@/db/schema";
import { requireUser, handleApiError } from "@/lib/api";
import { participatesInTask } from "@/lib/task-collaborators";

// 工作台聚合统计：GET /api/overview
// 返回我加入的团队数、可见项目数、任务总量/已完成、我的任务（待办/进行中）——侧栏徽标与概览卡片用
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);

    const myTeams = await db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, user.id));
    const teamIds = myTeams.map((t) => t.id);
    if (teamIds.length === 0) {
      return Response.json({
        overview: { teamCount: 0, projectCount: 0, taskTotal: 0, taskDone: 0, myTodo: 0, myDoing: 0 },
      });
    }

    const myProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(inArray(projects.teamId, teamIds), eq(projects.status, "active")));
    const projectIds = myProjects.map((p) => p.id);

    let taskTotal = 0, taskDone = 0, myTodo = 0, myDoing = 0;
    if (projectIds.length > 0) {
      const statRows = await db
        .select({ status: tasks.status, count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(inArray(tasks.projectId, projectIds))
        .groupBy(tasks.status);
      for (const row of statRows) {
        taskTotal += row.count;
        if (row.status === "done") taskDone += row.count;
      }

      const mineRows = await db
        .select({ status: tasks.status, count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), participatesInTask(user.id)))
        .groupBy(tasks.status);
      for (const row of mineRows) {
        if (row.status === "todo") myTodo += row.count;
        if (row.status === "doing") myDoing += row.count;
      }
    }

    return Response.json({
      overview: {
        teamCount: teamIds.length,
        projectCount: projectIds.length,
        taskTotal,
        taskDone,
        myTodo,
        myDoing,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
