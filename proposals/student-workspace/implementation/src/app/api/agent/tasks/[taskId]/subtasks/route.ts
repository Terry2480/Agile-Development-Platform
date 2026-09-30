import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { createSubtask, listSubtasks } from "@/lib/task";

type Ctx = { params: Promise<{ taskId: string }> };

function parseTaskId(raw: string) {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
}

// CC 读取：列出该任务下的子任务（直接子级，不递归）。
export async function GET(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { taskId: raw } = await ctx.params;
  const taskId = parseTaskId(raw);
  if (!taskId) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  try {
    const subtasks = await listSubtasks(userId, taskId);
    return NextResponse.json({ parentTaskId: taskId, subtasks });
  } catch (e) {
    return mapAgentError(e, "[GET /api/agent/tasks/:id/subtasks]");
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

// CC 写入：在该任务下建子任务。所属项目由父任务推得，调用方无须传 projectId。
export async function POST(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { taskId: raw } = await ctx.params;
  const taskId = parseTaskId(raw);
  if (!taskId) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await createSubtask(userId, taskId, parsed.data);
    return NextResponse.json({
      id: task.id,
      title: task.title,
      status: task.status,
      parentTaskId: task.parentTaskId,
      projectId: task.projectId,
    });
  } catch (e) {
    return mapAgentError(e, "[POST /api/agent/tasks/:id/subtasks]");
  }
}
