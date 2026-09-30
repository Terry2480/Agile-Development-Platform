import { NextResponse } from "next/server";
import { scanAndNotifyDue } from "@/lib/notify";

// 定时提醒端点：外部调度每日打一次。CRON_SECRET 为唯一护栏。
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() : null;
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const result = await scanAndNotifyDue();
    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/cron/reminders]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
