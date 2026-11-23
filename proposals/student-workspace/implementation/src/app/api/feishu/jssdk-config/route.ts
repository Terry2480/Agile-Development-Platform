import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getJsapiTicket, buildJsapiSignature } from "@/lib/feishu";

// 前端 JSSDK 鉴权签名签发。入参 url=当前页面完整 URL（不含 #fragment）。
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "缺 url" }, { status: 400 });

  try {
    const ticket = await getJsapiTicket();
    const nonceStr = randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const signature = buildJsapiSignature({ ticket, nonceStr, timestamp, url });
    return NextResponse.json({
      appId: process.env.FEISHU_APP_ID ?? "",
      timestamp,
      nonceStr,
      signature,
    });
  } catch (e) {
    console.error("[feishu jssdk-config]", e);
    return NextResponse.json({ error: "签名失败" }, { status: 500 });
  }
}
