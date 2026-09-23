import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BASE = process.env.FEISHU_BASE_URL ?? "https://open.feishu.cn";

// 发起飞书 OAuth——登录与绑定共用。用途由 callback 按 session 有无分流。
export async function GET() {
  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("feishu_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  const authorize = new URL(`${BASE}/open-apis/authen/v1/authorize`);
  authorize.searchParams.set("app_id", process.env.FEISHU_APP_ID ?? "");
  authorize.searchParams.set("redirect_uri", process.env.FEISHU_REDIRECT_URI ?? "");
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}
