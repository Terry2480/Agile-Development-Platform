import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { dbClient?: ReturnType<typeof postgres> };

const client = globalForDb.dbClient ?? postgres(process.env.DATABASE_URL!);
if (process.env.NODE_ENV !== "production") globalForDb.dbClient = client;

export const db = drizzle(client, { schema });

// 事务连接类型：createTask/updateTask 等可选在事务内执行
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
