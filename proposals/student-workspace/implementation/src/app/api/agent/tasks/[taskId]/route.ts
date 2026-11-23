import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { getTaskDetail } from "@/lib/task";

type Ctx = { params: Promise<{ taskId: string }> };

// CC 读取：单任务详情（按 id 直取，含负责人名与完成情况）。
export async function GET(req: Request, ctx: Ctx) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const { taskId: raw } = await ctx.params;
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });

  try {
    const t = await getTaskDetail(userId, parsed.data);
    return NextResponse.json(t);
  } catch (e) {
    return mapAgentError(e, "[GET /api/agent/tasks/:id]");
  }
}
