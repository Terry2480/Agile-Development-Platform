import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { createResourceUsage } from "@/lib/resource";

const schema = z.object({
  teamId: z.uuid(),
  resourceName: z.string().min(1),
  purpose: z.string().optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date().optional(),
});

// CC 写入 / D 共用：登记资源占用。lib 校验团队成员身份。
export async function POST(req: Request) {
  const userId = await authenticateBearer(req);
  if (!userId) return unauthorized();

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { teamId, ...input } = parsed.data;
    const usage = await createResourceUsage(userId, teamId, input);
    return NextResponse.json({
      id: usage.id,
      resourceName: usage.resourceName,
      active: usage.endTime === null,
    });
  } catch (e) {
    return mapAgentError(e, "[/api/agent/resource-usage]");
  }
}
