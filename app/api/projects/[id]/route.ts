import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects, projectMembers, projectStars, sprints, tasks, teamMembers, labels, users,
} from "@/db/schema";
import { requireUser, parseBody, parseId, requireProjectAccess, handleApiError, displayName } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { tryFileCleanup } from "@/lib/file-cleanup";
import { memberOnline } from "@/lib/presence";

// 项目详情 / 更新 / 删除：GET / PUT / DELETE /api/projects/[id]
// GET 返回项目 + 团队信息 + 成员 + Sprint 列表 + 团队标签 + 任务统计 + 是否星标
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project, team, membership } = await requireProjectAccess(user.id, projectId);

    const members = await db
      .select({
        userId: users.id,
        name: users.name,
        studentId: users.studentId,
        email: users.email,
        role: teamMembers.role,
        duty: teamMembers.duty,
        duties: teamMembers.duties,
        online: memberOnline(users.id),
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(teamMembers, and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, users.id)))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(users.id);

    const sprintRows = await db
      .select()
      .from(sprints)
      .where(eq(sprints.projectId, projectId))
      .orderBy(sprints.createdAt);

    const labelRows = await db.select().from(labels).where(eq(labels.teamId, project.teamId)).orderBy(labels.createdAt);

    const statsRows = await db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.status);
    const taskCounts = { total: 0, todo: 0, doing: 0, done: 0 };
    for (const s of statsRows) {
      taskCounts.total += s.count;
      if (s.status in taskCounts) taskCounts[s.status as keyof typeof taskCounts] = s.count;
    }

    const [star] = await db
      .select({ id: projectStars.id })
      .from(projectStars)
      .where(and(eq(projectStars.projectId, projectId), eq(projectStars.userId, user.id)))
      .limit(1);

    return Response.json({
      project,
      team: { id: team.id, name: team.name, description: team.description },
      myRole: membership.role,
      members: members.map((m) => ({ ...m, displayName: displayName(m) })),
      sprints: sprintRows,
      labels: labelRows,
      taskCounts,
      starred: Boolean(star),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名称").max(50, "项目名称过长").optional(),
  description: z.string().trim().max(500, "项目描述过长").optional().nullable(),
  courseName: z.string().trim().max(100, "课程名称最多 100 个字").optional().nullable(),
  status: z.enum(["active", "archived"], { message: "状态不合法" }).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId, "admin");
    const body = await parseBody(request, updateSchema);
    if(body.status&&body.status!==project.status&&typeof db.execute==="function"){
      const {documentsEnabled}=await import("@/lib/documents/lifecycle");if(await documentsEnabled(db)){
        const editing=await db.execute<{name:string;editor:string}>(sql`SELECT n.name,coalesce(nullif(u.name,''),u.student_id,'团队成员') AS editor FROM document_edit_locks l JOIN document_nodes n ON n.id=l.node_id JOIN document_spaces s ON s.id=n.space_id LEFT JOIN users u ON u.id=l.user_id WHERE s.project_id=${projectId} AND l.expires_at>clock_timestamp()`);
        if(editing.length)return Response.json({code:"DOCUMENT_EDITING",error:`请先结束编辑：${editing.map(n=>`${n.name}（${n.editor}）`).join('、')}`},{status:409});
      }
    }


    const [updated] = await db
      .update(projects)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.courseName !== undefined ? { courseName: body.courseName || null } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(eq(projects.id, projectId))
      .returning();

    if (body.status && body.status !== project.status) {
      await logActivity({
        projectId,
        actorId: user.id,
        action: body.status === "archived" ? "project.archived" : "project.restored",
        detail: `${displayName(user)} ${body.status === "archived" ? "归档了" : "恢复了"}项目 ${updated.name}`,
      });
    }
    return Response.json({ project: updated });
  } catch (error) {
    if(String((error as {cause?:{message?:string}})?.cause?.message??"").includes("DOCUMENT_")){const {documentErrorResponse}=await import("@/lib/documents/errors");return documentErrorResponse(error);}
    return handleApiError(error);
  }
}

// 删除项目：owner / admin（级联删除项目全部数据）
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const projectId = parseId((await params).id, "项目 ID");
    const { project } = await requireProjectAccess(user.id, projectId, "admin");

    if(typeof db.execute==="function"){
      const {documentsEnabled,createDocumentLifecycle}=await import("@/lib/documents/lifecycle");
      if(await documentsEnabled(db)){
        try{const {deletionInput}=await import("@/lib/documents/validation");const input=deletionInput.parse(await request.json());
          const result=await createDocumentLifecycle().remove(user.id,"project",projectId,input);await tryFileCleanup();return Response.json(result);
        }catch(error){const {documentErrorResponse}=await import("@/lib/documents/errors");return documentErrorResponse(error);}
      }
    }
    await db.delete(projects).where(eq(projects.id, projectId));
    await tryFileCleanup();
    return Response.json({ ok: true, deleted: project.name });
  } catch (error) {
    return handleApiError(error);
  }
}
