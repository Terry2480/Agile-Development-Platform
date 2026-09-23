import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// 连接字符串来自 .env.local（Next.js 运行时会自动加载）
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString);

// 这就是你以后在应用里查询数据库用的对象
export const db = drizzle(client);
