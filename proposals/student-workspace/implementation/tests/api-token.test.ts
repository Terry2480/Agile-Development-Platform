import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import {
  createApiToken,
  verifyApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api-token";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

describe("createApiToken", () => {
  beforeEach(resetDb);

  it("返回明文 token（只此一次）与元数据", async () => {
    const user = await makeUser("owner@example.com");
    const result = await createApiToken(user.id, "我的 CC 令牌");
    expect(result.token).toBeTruthy();
    expect(result.token).toMatch(/^ac_/);
    expect(result.name).toBe("我的 CC 令牌");
    expect(result.id).toBeTruthy();
    // 明文只在生成时返回；列表不含明文
    const list = await listApiTokens(user.id);
    expect(list[0]).not.toHaveProperty("token");
    expect(list[0]).not.toHaveProperty("tokenHash");
  });

  it("名称去空白；纯空白名称被拒", async () => {
    const user = await makeUser("owner@example.com");
    const r = await createApiToken(user.id, "  含空白  ");
    expect(r.name).toBe("含空白");
    await expect(createApiToken(user.id, "   ")).rejects.toThrow("令牌名称");
  });

  it("两次生成的明文各异", async () => {
    const user = await makeUser("owner@example.com");
    const a = await createApiToken(user.id, "甲");
    const b = await createApiToken(user.id, "乙");
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyApiToken", () => {
  beforeEach(resetDb);

  it("有效明文换得 userId 并更新 lastUsedAt", async () => {
    const user = await makeUser("owner@example.com");
    const { token } = await createApiToken(user.id, "令牌");

    const before = await listApiTokens(user.id);
    expect(before[0].lastUsedAt).toBeNull();

    const uid = await verifyApiToken(token);
    expect(uid).toBe(user.id);

    const after = await listApiTokens(user.id);
    expect(after[0].lastUsedAt).not.toBeNull();
  });

  it("伪造/畸形/空 token 得 null", async () => {
    expect(await verifyApiToken("ac_forged")).toBeNull();
    expect(await verifyApiToken("no-prefix")).toBeNull();
    expect(await verifyApiToken("")).toBeNull();
  });

  it("已撤销的 token 得 null", async () => {
    const user = await makeUser("owner@example.com");
    const { id, token } = await createApiToken(user.id, "令牌");
    await revokeApiToken(user.id, id);
    expect(await verifyApiToken(token)).toBeNull();
  });
});

describe("listApiTokens / revokeApiToken", () => {
  beforeEach(resetDb);

  it("按创建倒序列举本人全部令牌，含状态字段", async () => {
    const user = await makeUser("owner@example.com");
    await createApiToken(user.id, "甲");
    await createApiToken(user.id, "乙");
    const list = await listApiTokens(user.id);
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("乙"); // 倒序
    expect(list[0]).toHaveProperty("createdAt");
    expect(list[0]).toHaveProperty("revokedAt");
  });

  it("只见本人令牌，不见他人", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await createApiToken(a.id, "甲的令牌");
    await createApiToken(b.id, "乙的令牌");
    expect(await listApiTokens(a.id)).toHaveLength(1);
    expect((await listApiTokens(a.id))[0].name).toBe("甲的令牌");
  });

  it("撤销他人令牌被拒（越权）", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    const { id } = await createApiToken(a.id, "甲的令牌");
    await expect(revokeApiToken(b.id, id)).rejects.toThrow();
    // 甲的令牌仍有效
    expect((await listApiTokens(a.id))[0].revokedAt).toBeNull();
  });

  it("重复撤销同一令牌被拒", async () => {
    const user = await makeUser("owner@example.com");
    const { id } = await createApiToken(user.id, "令牌");
    await revokeApiToken(user.id, id);
    await expect(revokeApiToken(user.id, id)).rejects.toThrow();
  });
});
