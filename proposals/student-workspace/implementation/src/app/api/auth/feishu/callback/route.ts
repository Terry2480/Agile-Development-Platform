import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth, signIn } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/feishu";
import { bindFeishu } from "@/lib/user";
import { AppError } from "@/lib/errors";

const SITE = process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// signIn 成功时抛出 NEXT_REDIRECT——须原样上抛，不可当错误吞掉。
function isRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

// 回调：校 state → 有 session 则绑定当前用户，无 session 则以此 code 飞书登录。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expected = store.get("feishu_oauth_state")?.value;
  store.delete("feishu_oauth_state");

  const settings = new URL("/settings", SITE);
  if (!code || !state || !expected || state !== expected) {
    settings.searchParams.set("feishu", "state_error");
    return NextResponse.redirect(settings);
  }

  const session = await auth();

  if (session?.user) {
    // 已登录 → 绑定（自己 exchange，code 只用一次）
    try {
      const { openId, name } = await exchangeOAuthCode(code);
      await bindFeishu(session.user.id, { openId, name });
      settings.searchParams.set("feishu", "bound");
    } catch (e) {
      settings.searchParams.set("feishu", e instanceof AppError ? "conflict" : "error");
      if (!(e instanceof AppError)) console.error("[feishu callback bind]", e);
    }
    return NextResponse.redirect(settings);
  }

  // 未登录 → 飞书登录：把 code 交给 provider（authorize 内 exchange），signIn 抛 redirect 上抛
  try {
    await signIn("feishu", { code, redirectTo: "/teams" });
  } catch (e) {
    if (isRedirect(e)) throw e;
    const login = new URL("/login", SITE);
    login.searchParams.set("feishu", "login_error");
    return NextResponse.redirect(login);
  }
}
