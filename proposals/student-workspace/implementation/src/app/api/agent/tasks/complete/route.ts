import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { updateTask } from "@/lib/task";

const schema = z.object({
  taskId: z.uuid(),
  completionNote: z.string().min(1),
});

// CC 写入：填完成情况——标记 done 并附完成说明。lib 校验写权限。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const task = await updateTask(userId, parsed.data.taskId, {
      status: "done",
      completionNote: parsed.data.completionNote,
    });
    return NextResponse.json({ id: task.id, status: task.status });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/tasks/complete]");
  }
}
