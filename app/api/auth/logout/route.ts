import { destroySession, readToken } from "@/lib/auth";
import { sessionCookie } from "@/lib/request-security";

// 退出接口：POST /api/auth/logout
// 删除会话记录并清空 Cookie——退出后才能登录新用户
export async function POST(request: Request) {
  const token = readToken(request);
  const setCookie = token
    ? await destroySession(token)
    : sessionCookie("", 0);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": setCookie } });
}
