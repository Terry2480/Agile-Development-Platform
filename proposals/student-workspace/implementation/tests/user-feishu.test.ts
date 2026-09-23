import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createUser, bindFeishu, unbindFeishu, findOrCreateByFeishu } from "@/lib/user";
import { AppError } from "@/lib/errors";
import { resetDb } from "./helpers";

describe("飞书绑定", () => {
  beforeEach(resetDb);

  it("绑定写入 openId/name/boundAt", async () => {
    const u = await createUser({ email: "a@e.com", password: "password123", name: "甲" });
    await bindFeishu(u.id, { openId: "ou_1", name: "甲的飞书" });

    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.feishuOpenId).toBe("ou_1");
    expect(row.feishuName).toBe("甲的飞书");
    expect(row.feishuBoundAt).not.toBeNull();
  });

  it("同一飞书号绑两个账号 → AppError", async () => {
    const a = await createUser({ email: "a@e.com", password: "password123", name: "甲" });
    const b = await createUser({ email: "b@e.com", password: "password123", name: "乙" });
    await bindFeishu(a.id, { openId: "ou_dup", name: "x" });
    await expect(bindFeishu(b.id, { openId: "ou_dup", name: "y" })).rejects.toBeInstanceOf(AppError);
  });

  it("解绑清空三字段", async () => {
    const u = await createUser({ email: "a@e.com", password: "password123", name: "甲" });
    await bindFeishu(u.id, { openId: "ou_1", name: "甲" });
    await unbindFeishu(u.id);

    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.feishuOpenId).toBeNull();
    expect(row.feishuName).toBeNull();
    expect(row.feishuBoundAt).toBeNull();
  });
});

describe("findOrCreateByFeishu 混合建号", () => {
  beforeEach(resetDb);

  it("openId 已绑定 → 返回原账号（不建新号）", async () => {
    const u = await createUser({ email: "a@e.com", password: "password123", name: "甲" });
    await bindFeishu(u.id, { openId: "ou_exist", name: "甲飞书" });

    const r = await findOrCreateByFeishu({ openId: "ou_exist", name: "甲飞书" });
    expect(r.id).toBe(u.id);

    const all = await db.select().from(users);
    expect(all).toHaveLength(1); // 未建新号
  });

  it("openId 未绑定 → 自动建号（占位 email、飞书身份）", async () => {
    const r = await findOrCreateByFeishu({ openId: "ou_new", name: "新人" });

    const [row] = await db.select().from(users).where(eq(users.id, r.id));
    expect(row.email).toBe("ou_new@feishu.local");
    expect(row.feishuOpenId).toBe("ou_new");
    expect(row.feishuName).toBe("新人");
    expect(row.name).toBe("新人");
    expect(row.passwordHash.length).toBeGreaterThan(0); // 有不可用 hash
  });

  it("同一 openId 二次调用 → 复用首次所建账号", async () => {
    const a = await findOrCreateByFeishu({ openId: "ou_x", name: "x" });
    const b = await findOrCreateByFeishu({ openId: "ou_x", name: "x2" });
    expect(b.id).toBe(a.id);
    const all = await db.select().from(users);
    expect(all).toHaveLength(1);
  });
});
