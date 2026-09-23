import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createUser, bindFeishu, loginWithFeishuCode } from "@/lib/user";
import { resetDb } from "./helpers";

// mock 斥候：code → openId/name，隔离飞书网络
const exchangeMock = vi.fn();
vi.mock("@/lib/feishu", () => ({
  exchangeOAuthCode: (...a: unknown[]) => exchangeMock(...a),
}));

describe("loginWithFeishuCode", () => {
  beforeEach(async () => { await resetDb(); exchangeMock.mockReset(); });

  it("code 换 openId 命中已绑账号 → 登录该账号", async () => {
    const u = await createUser({ email: "a@e.com", password: "password123", name: "甲" });
    await bindFeishu(u.id, { openId: "ou_1", name: "甲" });
    exchangeMock.mockResolvedValue({ openId: "ou_1", name: "甲" });

    const r = await loginWithFeishuCode("the-code");
    expect(r.id).toBe(u.id);
    expect(exchangeMock).toHaveBeenCalledWith("the-code");
  });

  it("code 换 openId 未绑 → 自动建号并登录", async () => {
    exchangeMock.mockResolvedValue({ openId: "ou_new", name: "新人" });
    const r = await loginWithFeishuCode("code2");
    const [row] = await db.select().from(users).where(eq(users.id, r.id));
    expect(row.feishuOpenId).toBe("ou_new");
    expect(row.email).toBe("ou_new@feishu.local");
  });
});
