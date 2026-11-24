import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// 连接字符串来自 .env.local（Next.js 运行时会自动加载）
const connectionString = process.env.DATABASE_URL!;

const development = process.env.NODE_ENV === "development";
const processState = globalThis as typeof globalThis & {
  agileCampusDatabaseClient?: ReturnType<typeof postgres>;
};

// Webpack can re-evaluate this module when routes compile or hot reload.
const client = development
  ? (processState.agileCampusDatabaseClient ??= postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
    }))
  : postgres(connectionString);

// 这就是你以后在应用里查询数据库用的对象
export const db = drizzle(client);
