import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { createProject, listMyProjects } from "@/lib/project";

// CC 读取：列出令牌主人参与的全部项目（跨团队）。
export async function GET(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  try {
    const rows = await listMyProjects(userId);
    return NextResponse.json({
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        teamId: p.teamId,
        teamName: p.teamName,
        taskTotal: p.taskTotal,
        doneCount: p.doneCount,
      })),
    });
  } catch (e) {
    return mapAgentError(e, "[GET /api/agent/projects]");
  }
}

const createSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// CC 写入：在指定团队下新建项目。createProject 内校验令牌主人须为该团队 admin。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { teamId, ...input } = parsed.data;
    const project = await createProject(userId, teamId, input);
    return NextResponse.json({ id: project.id, name: project.name, status: project.status });
  } catch (e) {
    return mapAgentError(e, "[POST /api/agent/projects]");
  }
}
