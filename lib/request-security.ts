export function sessionCookie(value: string, maxAge: number, production = process.env.NODE_ENV === "production") {
  return `agile_session=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${production ? "; Secure" : ""}`;
}

export function checkRequestOrigin(request: Request, production = process.env.NODE_ENV === "production", configured = process.env.AUTH_ALLOWED_ORIGINS ?? "") {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const allowed = configured.split(",").map((s) => s.trim()).filter(Boolean);
  if (production && !allowed.length) return Response.json({ error: "服务器未配置可信访问地址，请联系管理员" }, { status: 503 });
  try {
    if (allowed.some((s) => { const u = new URL(s); return u.origin !== s || (production && u.protocol !== "https:"); })) {
      return Response.json({ error: "服务器可信访问地址配置不正确" }, { status: 503 });
    }
    const originHeader = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (!originHeader && !referer) return Response.json({ error: "请求缺少来源信息，请从平台页面操作" }, { status: 403 });
    const source = new URL(originHeader ?? referer!).origin;
    if (originHeader && originHeader !== source) throw new Error("invalid origin");
    const target = new URL(request.url);
    const local = !production && !allowed.length && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && source === target.origin;
    if (!local && !allowed.includes(source)) return Response.json({ error: "不允许来自该网站的操作请求" }, { status: 403 });
    return null;
  } catch { return Response.json({ error: "请求来源无效" }, { status: 403 }); }
}
