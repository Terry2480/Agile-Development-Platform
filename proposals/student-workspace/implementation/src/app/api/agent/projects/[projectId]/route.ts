import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { getProjectDetail, updateProject } from "@/lib/project";

type Ctx = { params: Promise<{ projectId: string }> };

// 路径参数亦属外部输入，同样先过 Zod 再入 lib
function parseProjectId(raw: string) {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
}

// CC 读取：项目详情——本体 + 里程碑 + 任务状态计数。
export async function GET(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { projectId: raw } = await ctx.params;
  const projectId = parseProjectId(raw);
  if (!projectId) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  try {
    const d = await getProjectDetail(userId, projectId);
    return NextResponse.json({
      id: d.project.id,
      name: d.project.name,
      description: d.project.description,
      status: d.project.status,
      startDate: d.project.startDate,
      endDate: d.project.endDate,
      teamId: d.project.teamId,
      myRole: d.role,
      taskTotal: d.taskTotal,
      byStatus: d.byStatus,
      milestones: d.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        targetDate: m.targetDate,
      })),
    });
  } catch (e) {
    return mapAgentError(e, "[GET /api/agent/projects/:id]");
  }
}

// null 显式表示「清空该字段」，与 undefined（不改）区分
const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "至少提供一个待改字段" });

// CC 写入：改项目信息或归档。updateProject 内校验令牌主人须为该团队 admin。
export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { projectId: raw } = await ctx.params;
  const projectId = parseProjectId(raw);
  if (!projectId) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const p = await updateProject(userId, projectId, parsed.data);
    return NextResponse.json({ id: p.id, name: p.name, status: p.status });
  } catch (e) {
    return mapAgentError(e, "[PATCH /api/agent/projects/:id]");
  }
}
