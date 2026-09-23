import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FEISHU_APP_ID", "cli_test");
  vi.stubEnv("FEISHU_APP_SECRET", "secret_test");
  vi.stubEnv("FEISHU_BASE_URL", "https://open.feishu.cn");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("getJsapiTicket", () => {
  it("取 ticket 并缓存（第二次不再打网络）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { ticket: "tk-1", expire_in: 7200 } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getJsapiTicket } = await import("@/lib/feishu");
    expect(await getJsapiTicket()).toBe("tk-1");
    expect(await getJsapiTicket()).toBe("tk-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("buildJsapiSignature", () => {
  it("签名 = sha1(jsapi_ticket=..&noncestr=..&timestamp=..&url=..)", async () => {
    const { buildJsapiSignature } = await import("@/lib/feishu");
    const sig = buildJsapiSignature({ ticket: "tk", nonceStr: "n", timestamp: 123, url: "https://x/y" });
    const expected = createHash("sha1")
      .update("jsapi_ticket=tk&noncestr=n&timestamp=123&url=https://x/y")
      .digest("hex");
    expect(sig).toBe(expected);
  });
});
