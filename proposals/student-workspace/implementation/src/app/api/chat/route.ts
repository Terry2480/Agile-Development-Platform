import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  projectId: z.uuid(),
  userText: z.string().trim().min(1, "请输入内容"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await runAgentTurn({
      actorId: session.user.id,
      projectId: parsed.data.projectId,
      userText: parsed.data.userText,
    });
    return NextResponse.json({ text: result.text, toolTrace: result.toolTrace, drafts: result.drafts });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    // 未预期错误（含 DeepSeek 超时/失败）：服务端留痕，对客户端只呈通用消息，不暴露内部细节
    console.error("[/api/chat] runAgentTurn 失败:", e);
    return NextResponse.json({ error: "对话失败，请重试" }, { status: 500 });
  }
}
