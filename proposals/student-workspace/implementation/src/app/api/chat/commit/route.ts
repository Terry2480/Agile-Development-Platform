import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { commitDraft } from "@/lib/agent/commit";
import { WRITE_TOOL_NAMES } from "@/lib/agent/tools";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  projectId: z.uuid(),
  tool: z.enum(WRITE_TOOL_NAMES),
  draft: z.unknown(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await commitDraft(
      session.user.id,
      parsed.data.projectId,
      parsed.data.tool,
      parsed.data.draft,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "草案格式无效" }, { status: 400 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/chat/commit] 落库失败:", e);
    return NextResponse.json({ error: "落库失败，请重试" }, { status: 500 });
  }
}
