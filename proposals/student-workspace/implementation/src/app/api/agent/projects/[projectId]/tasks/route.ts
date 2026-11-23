import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { createTask, listProjectTasks } from "@/lib/task";

type Ctx = { params: Promise<{ projectId: string }> };

function parseProjectId(raw: string) {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
}

const filterSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.uuid().optional(),
  dueBefore: z.string().optional(),
});

// CC 读取：列出该项目任务，可按状态/负责人/截止日筛。填补「CC 无读端点」之缺。
export async function GET(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { projectId: raw } = await ctx.params;
  const projectId = parseProjectId(raw);
  if (!projectId) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  const q = new URL(req.url).searchParams;
  const parsed = filterSchema.safeParse({
    status: q.get("status") ?? undefined,
    assigneeId: q.get("assigneeId") ?? undefined,
    dueBefore: q.get("dueBefore") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const f = parsed.data;

  try {
    let rows = await listProjectTasks(userId, projectId);
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.assigneeId) rows = rows.filter((t) => t.assigneeId === f.assigneeId);
    if (f.dueBefore) rows = rows.filter((t) => t.dueDate !== null && t.dueDate <= f.dueBefore!);

    return NextResponse.json({
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate,
        dueDate: t.dueDate,
        milestoneId: t.milestoneId,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeName,
        completionNote: t.completionNote,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (e) {
    return mapAgentError(e, "[GET /api/agent/projects/:id/tasks]");
  }
}

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.uuid().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

// CC 写入：在该项目下新建任务（projectId 取自路径）。
// 与既有 POST /api/agent/tasks（projectId 在 body）并存：后者为旧约，不折损在用之 skill。
export async function POST(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { projectId: raw } = await ctx.params;
  const projectId = parseProjectId(raw);
  if (!projectId) return NextResponse.json({ error: "projectId 无效" }, { status: 400 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await createTask(userId, projectId, parsed.data);
    return NextResponse.json({ id: task.id, title: task.title, status: task.status });
  } catch (e) {
    return mapAgentError(e, "[POST /api/agent/projects/:id/tasks]");
  }
}
