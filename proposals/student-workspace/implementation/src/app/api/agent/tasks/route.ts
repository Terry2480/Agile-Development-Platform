import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { createTask } from "@/lib/task";

const schema = z.object({
  projectId: z.uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.uuid().optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  milestoneId: z.uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

// CC 写入：新建任务。token → userId → lib（lib 内校验该 userId 对目标项目的写权限）。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { projectId, ...input } = parsed.data;
    const task = await createTask(userId, projectId, input);
    return NextResponse.json({ id: task.id, title: task.title, status: task.status });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/tasks]");
  }
}
