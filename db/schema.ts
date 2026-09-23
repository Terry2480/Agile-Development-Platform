import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// 第一张示例表：users（用来验证「数据库 → Drizzle」通路是否打通）
// 后续会在这里补全 13 张表的完整设计。
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow(),
});
