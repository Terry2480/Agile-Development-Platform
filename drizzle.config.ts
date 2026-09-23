import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// 手动加载 .env.local（drizzle-kit 默认只读 .env，不会自动读 .env.local）
config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
