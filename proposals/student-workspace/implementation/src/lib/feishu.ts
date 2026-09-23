import { createHash } from "node:crypto";
// 飞书斥候：自建应用 API 封装。所有请求以 FEISHU_BASE_URL 为 base。
// 端点基于飞书开放平台标准；实现前以官方文档核验路径与字段。

const BASE = () => process.env.FEISHU_BASE_URL ?? "https://open.feishu.cn";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`[feishu] 缺环境变量 ${key}`);
  return v;
}

// tenant_access_token 内存缓存：{ token, 过期毫秒时间戳 }。留 300s 安全余量。
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getTenantAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`${BASE()}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app_id: requireEnv("FEISHU_APP_ID"),
      app_secret: requireEnv("FEISHU_APP_SECRET"),
    }),
  });
  const data = (await res.json()) as { code: number; tenant_access_token?: string; expire?: number; msg?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`[feishu] 取 tenant_access_token 失败：${data.code} ${data.msg ?? ""}`);
  }
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000 - 300_000,
  };
  return tokenCache.token;
}

// OAuth：授权码 → 用户身份。v2 token 端点直接用 client_id/secret 换 user_access_token，
// 再取用户信息拿 open_id。redirect_uri 须与授权发起时一致。
export async function exchangeOAuthCode(code: string): Promise<{ openId: string; name: string }> {
  const tokenRes = await fetch(`${BASE()}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: requireEnv("FEISHU_APP_ID"),
      client_secret: requireEnv("FEISHU_APP_SECRET"),
      code,
      redirect_uri: requireEnv("FEISHU_REDIRECT_URI"),
    }),
  });
  const tokenData = (await tokenRes.json()) as { code?: number; access_token?: string; msg?: string };
  if (!tokenData.access_token) {
    throw new Error(`[feishu] OAuth 换 token 失败：${tokenData.code} ${tokenData.msg ?? ""}`);
  }

  const infoRes = await fetch(`${BASE()}/open-apis/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  const info = (await infoRes.json()) as { code: number; data?: { open_id: string; name: string }; msg?: string };
  if (info.code !== 0 || !info.data) {
    throw new Error(`[feishu] 取用户信息失败：${info.code} ${info.msg ?? ""}`);
  }
  return { openId: info.data.open_id, name: info.data.name };
}

// 发文本私信。content 须为 JSON 字符串（飞书要求）。
export async function sendTextMessage(openId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${BASE()}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
  const data = (await res.json()) as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`[feishu] 发消息失败：${data.code} ${data.msg ?? ""}`);
}

// jsapi_ticket 内存缓存（仿 tenant_access_token），留 300s 安全余量。
let ticketCache: { ticket: string; expiresAt: number } | null = null;

export async function getJsapiTicket(): Promise<string> {
  if (ticketCache && Date.now() < ticketCache.expiresAt) return ticketCache.ticket;

  const token = await getTenantAccessToken();
  const res = await fetch(`${BASE()}/open-apis/jssdk/ticket/get`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const data = (await res.json()) as {
    code: number;
    data?: { ticket: string; expire_in: number };
    msg?: string;
  };
  if (data.code !== 0 || !data.data) {
    throw new Error(`[feishu] 取 jsapi_ticket 失败：${data.code} ${data.msg ?? ""}`);
  }
  ticketCache = {
    ticket: data.data.ticket,
    expiresAt: Date.now() + (data.data.expire_in ?? 7200) * 1000 - 300_000,
  };
  return ticketCache.ticket;
}

// JSSDK config 签名：sha1(拼接串)。串顺序与字段名由飞书规定，实现前核验。
export function buildJsapiSignature(input: {
  ticket: string;
  nonceStr: string;
  timestamp: number;
  url: string;
}): string {
  const raw = `jsapi_ticket=${input.ticket}&noncestr=${input.nonceStr}&timestamp=${input.timestamp}&url=${input.url}`;
  return createHash("sha1").update(raw).digest("hex");
}

// 发 interactive 卡片私信。card 为飞书卡片 JSON 对象，content 须序列化为字符串。
export async function sendCardMessage(openId: string, card: unknown): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${BASE()}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  });
  const data = (await res.json()) as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`[feishu] 发卡片失败：${data.code} ${data.msg ?? ""}`);
}
