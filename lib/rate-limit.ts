import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export function requestSource(request: Request) {
  // 仅在受控反向代理覆盖 X-Real-IP 且应用不能被公网直连时启用。
  const value = process.env.TRUST_PROXY_IP === "true" ? request.headers.get("x-real-ip") : null;
  return value && isIP(value) ? value : "unverified-source";
}
export async function consumeLimit(key: string, limit: number, seconds: number) {
  const digest = createHash("sha256").update(key).digest("hex");
  const rows = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, count, expires_at)
    VALUES (${digest}, 1, now() + ${seconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.count + 1 END,
      expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN now() + ${seconds} * interval '1 second' ELSE auth_rate_limits.expires_at END
    RETURNING count, greatest(1, ceil(extract(epoch FROM expires_at - now())))::int AS retry_after
  `);
  const row = rows[0] as unknown as { count: number; retry_after: number };
  // 限流记录仅保留当前窗口，避免长期积累账号/IP摘要。
  await db.execute(sql`DELETE FROM auth_rate_limits WHERE expires_at <= now()`);
  return row.count > limit ? Response.json({ error: "操作过于频繁，请稍后重试", retryAfter: row.retry_after }, { status: 429, headers: { "Retry-After": String(row.retry_after) } }) : null;
}
