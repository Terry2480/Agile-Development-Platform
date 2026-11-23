import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiToken } from "./api-token";
import { AppError, ForbiddenError } from "./errors";

// 从 Authorization: Bearer <token> 提取并校验，得 userId | null。
// 外部写入的认证入口——不信任输入，缺失/畸形/伪造一律 null。
export async function authenticateBearer(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  return verifyApiToken(match[1].trim());
}

export function unauthorized() {
  return NextResponse.json({ error: "令牌无效或缺失" }, { status: 401 });
}

// 业务错误 → HTTP 状态。ForbiddenError 须先于 AppError 判（前者是后者子类）。
export function mapAgentError(e: unknown, tag: string) {
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
  if (e instanceof z.ZodError) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(tag, e);
  return NextResponse.json({ error: "服务器错误，请重试" }, { status: 500 });
}
