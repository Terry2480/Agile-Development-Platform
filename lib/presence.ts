import { sql, type SQLWrapper } from "drizzle-orm";

// sessions 的无时区时间戳由 Date.toISOString() 写入，保存的是 UTC。
// 显式使用 UTC 数据库时钟，避免部署环境的时区改变在线判断。
export const sessionNow = () => sql`(now() at time zone 'UTC')`;

export function memberOnline(userId: SQLWrapper) {
  return sql<boolean>`exists (
    select 1 from sessions
    where sessions.user_id = ${userId}
      and sessions.expires_at > ${sessionNow()}
      and sessions.last_active_at > ${sessionNow()} - interval '5 minutes'
  )`;
}
