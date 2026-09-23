import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 每个用例前重置模块缓存（getTenantAccessToken 的内存缓存跨用例会污染）
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FEISHU_APP_ID", "cli_test");
  vi.stubEnv("FEISHU_APP_SECRET", "secret_test");
  vi.stubEnv("FEISHU_BASE_URL", "https://open.feishu.cn");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getTenantAccessToken", () => {
  it("换取 token 并缓存（第二次不再打网络）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getTenantAccessToken } = await import("@/lib/feishu");
    expect(await getTenantAccessToken()).toBe("t-abc");
    expect(await getTenantAccessToken()).toBe("t-abc");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 缓存命中
  });

  it("飞书返回非零 code → 抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 99991663, msg: "app not found" }), { status: 200 }),
      ),
    );
    const { getTenantAccessToken } = await import("@/lib/feishu");
    await expect(getTenantAccessToken()).rejects.toThrow();
  });
});

describe("exchangeOAuthCode", () => {
  it("code 换 open_id 与 name", async () => {
    vi.stubEnv("FEISHU_REDIRECT_URI", "http://localhost:3000/api/auth/feishu/callback");
    const fetchMock = vi
      .fn()
      // 第一打：v2 oauth token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, access_token: "u-tok" }), { status: 200 }),
      )
      // 第二打：user_info
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, data: { open_id: "ou_123", name: "周瑜" } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeOAuthCode } = await import("@/lib/feishu");
    const r = await exchangeOAuthCode("the-code");
    expect(r).toEqual({ openId: "ou_123", name: "周瑜" });
  });
});

describe("sendTextMessage", () => {
  it("以 open_id 发文本（带 tenant token）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendTextMessage } = await import("@/lib/feishu");
    await sendTextMessage("ou_123", "军情急报");

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("/open-apis/im/v1/messages?receive_id_type=open_id");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.receive_id).toBe("ou_123");
    expect(body.msg_type).toBe("text");
    expect(JSON.parse(body.content).text).toBe("军情急报");
  });

  it("飞书返回非零 code → 抛错", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 230002, msg: "user not exist" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendTextMessage } = await import("@/lib/feishu");
    await expect(sendTextMessage("ou_x", "x")).rejects.toThrow();
  });
});

describe("sendCardMessage", () => {
  it("以 open_id 发 interactive 卡片（带 tenant token）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendCardMessage } = await import("@/lib/feishu");
    await sendCardMessage("ou_1", { config: {}, elements: [] });

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("/open-apis/im/v1/messages?receive_id_type=open_id");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.receive_id).toBe("ou_1");
    expect(body.msg_type).toBe("interactive");
    expect(typeof body.content).toBe("string");
    expect(JSON.parse(body.content)).toEqual({ config: {}, elements: [] });
  });

  it("飞书返回非零 code → 抛错", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 230006, msg: "bot not activated" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendCardMessage } = await import("@/lib/feishu");
    await expect(sendCardMessage("ou_x", {})).rejects.toThrow();
  });
});
