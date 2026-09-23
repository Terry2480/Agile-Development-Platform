# 飞书接入（绑定 + 私信提醒）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AgileCampus 经飞书 OAuth 绑定成员身份，并在任务被指派/完成时即时私信、临期/逾期时定时私信提醒；同期将 `commitDraft` 批量落库事务化。

**Architecture:** 飞书 API 封装为 `feishu.ts` 三个纯函数（mock fetch 离线可测）；OAuth 绑定经 login/callback 双路由写 `users` 飞书字段；通知业务 `notify.ts` 全程 fire-and-forget（飞书故障不阻断落库）；即时通知挂在 `task.ts` 写漏斗，定时通知由外部调度打 `/api/cron/reminders`；事务化让 `createTask`/`updateTask` 收可选 `tx`，通知永在事务提交后发。

**Tech Stack:** Next.js 16 (App Router) · Drizzle ORM + PostgreSQL · Auth.js v5 (`auth()`) · Zod · Vitest · 飞书开放平台自建应用 API

---

## 前置说明（executor 必读）

- 本项目 schema 用 `npm run db:push`（推 dev 库）+ `npm run db:push:test`（推 test 库），**非** migrate。改 schema 后两库都要 push。
- 测试：`npm test`（= `dotenv -e .env.test -- vitest run`）。单文件：`npm test -- tests/xxx.test.ts`。
- 错误约定（`src/lib/errors.ts`）：`AppError`（message 可展示）、`ForbiddenError`、`isUniqueViolation(e)`（查 23505）。
- 飞书凭证已在 `.env` 备妥：`FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_REDIRECT_URI`/`FEISHU_BASE_URL`（`https://open.feishu.cn`）/`CRON_SECRET`。`.env.test` 无飞书凭证——飞书相关测试用 `vi.stubEnv` 注入占位 + mock fetch，不打真机。
- **飞书 API 端点核验**：Task 2/3 代码基于飞书开放平台标准端点写就；executor 在实现前须以 context7 或飞书开放平台官方文档核验端点路径与字段名（飞书 API 有 v1/v2 演进），如有出入以官方为准，仅调 URL/字段、不改本计划的函数签名与测试。

---

## 文件结构总览

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/db/schema.ts` | `tasks.createdById` 字段（`users` 飞书字段已在工作区） | 改 |
| `src/db/index.ts` | 导出 `DbTx` 事务类型 | 改 |
| `src/lib/task.ts` | `createTask`/`updateTask` 写 `createdById` + 收 `tx` + 即时通知 | 改 |
| `src/lib/feishu.ts` | 飞书斥候：token/OAuth/发消息三纯函数 | 建 |
| `src/lib/user.ts` | `bindFeishu`/`unbindFeishu` | 改 |
| `src/lib/notify.ts` | 通知业务：assigned/completed/scanDue，fire-and-forget | 建 |
| `src/lib/agent/commit.ts` | 三分支裹事务 + 提交后补发通知 | 改 |
| `src/app/api/auth/feishu/login/route.ts` | OAuth 发起 | 建 |
| `src/app/api/auth/feishu/callback/route.ts` | OAuth 回调绑定 | 建 |
| `src/app/api/cron/reminders/route.ts` | 定时提醒端点 | 建 |
| `src/app/(app)/settings/page.tsx` | 设置页飞书绑定卡片 | 建 |
| `src/app/(app)/settings/feishu-card.tsx` | 绑定卡片 client 组件（解绑 action） | 建 |
| `tests/feishu.test.ts` · `tests/user-feishu.test.ts` · `tests/notify.test.ts` · `tests/task-notify.test.ts` · `tests/agent-commit.test.ts`(改) · `tests/cron-reminders.test.ts` | 测试 | 建/改 |

---

## Task 1: `tasks.createdById` 字段 + createTask 记录创建者

**Files:**
- Modify: `src/db/schema.ts`（tasks 表）
- Modify: `src/lib/task.ts:60-74`（createTask insert）
- Test: `tests/task.test.ts`（追加）

- [ ] **Step 1: 加 schema 字段**

在 `src/db/schema.ts` 的 `tasks` 表定义中，`assigneeId` 字段之后加：

```ts
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
```

- [ ] **Step 2: 推 schema 到两库**

Run:
```bash
npm run db:push && npm run db:push:test
```
Expected: 两库均新增 `tasks.created_by_id` 列，无报错。

- [ ] **Step 3: 写失败测试**

在 `tests/task.test.ts` 末尾（最后一个 `});` 之后）追加。若文件未 import `db`/`tasks`/`eq`，在顶部补 `import { db } from "@/db";`、`import { tasks } from "@/db/schema";`、`import { eq } from "drizzle-orm";`：

```ts
describe("createTask 记录创建者", () => {
  beforeEach(resetDb);

  it("createdById = 操作者", async () => {
    const owner = await createUser({ email: "o@e.com", password: "password123", name: "o" });
    const team = await createTeam(owner.id, "T");
    const project = await createProject(owner.id, team.id, { name: "P" });

    const task = await createTask(owner.id, project.id, { title: "活" });

    const [row] = await db.select({ createdById: tasks.createdById }).from(tasks).where(eq(tasks.id, task.id));
    expect(row.createdById).toBe(owner.id);
  });
});
```

- [ ] **Step 4: 跑测试验证失败**

Run: `npm test -- tests/task.test.ts`
Expected: 新测试 FAIL（`createdById` 为 null，≠ owner.id）。

- [ ] **Step 5: createTask 写入 createdById**

在 `src/lib/task.ts` 的 `createTask` 的 `.values({...})` 中，`projectId` 之后加一行：

```ts
      createdById: actorId,
```

- [ ] **Step 6: 跑测试验证通过**

Run: `npm test -- tests/task.test.ts`
Expected: PASS（含既有用例全绿）。

- [ ] **Step 7: 提交**

```bash
git add src/db/schema.ts src/lib/task.ts tests/task.test.ts
git commit -m "feat: tasks.createdById + createTask 记录创建者"
```

---

## Task 2: 飞书斥候 — getTenantAccessToken（含缓存）

**Files:**
- Create: `src/lib/feishu.ts`
- Test: `tests/feishu.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/feishu.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/feishu.test.ts`
Expected: FAIL（`@/lib/feishu` 不存在）。

- [ ] **Step 3: 建 feishu.ts（先只 token）**

Create `src/lib/feishu.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/feishu.test.ts`
Expected: PASS（两用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/feishu.ts tests/feishu.test.ts
git commit -m "feat: 飞书斥候 getTenantAccessToken(含缓存)"
```

---

## Task 3: 飞书斥候 — exchangeOAuthCode + sendTextMessage

**Files:**
- Modify: `src/lib/feishu.ts`
- Test: `tests/feishu.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `tests/feishu.test.ts` 末尾追加：

```ts
describe("exchangeOAuthCode", () => {
  it("code 换 open_id 与 name", async () => {
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/feishu.test.ts`
Expected: 新用例 FAIL（`exchangeOAuthCode`/`sendTextMessage` 未导出）。

- [ ] **Step 3: 补两函数**

在 `src/lib/feishu.ts` 末尾追加：

```ts
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/feishu.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 核验飞书端点**

用 context7 或访问飞书开放平台文档，核验三端点路径与字段名（`tenant_access_token/internal`、`authen/v2/oauth/token`、`authen/v1/user_info`、`im/v1/messages`）。若有出入，仅改 `feishu.ts` 的 URL/字段名，重跑 Step 4 保持绿。

- [ ] **Step 6: 提交**

```bash
git add src/lib/feishu.ts tests/feishu.test.ts
git commit -m "feat: 飞书斥候 exchangeOAuthCode + sendTextMessage"
```

---

## Task 4: 绑定业务 bindFeishu / unbindFeishu

**Files:**
- Modify: `src/lib/user.ts`
- Test: `tests/user-feishu.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/user-feishu.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createUser, bindFeishu, unbindFeishu } from "@/lib/user";
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/user-feishu.test.ts`
Expected: FAIL（`bindFeishu`/`unbindFeishu` 未导出）。

- [ ] **Step 3: 实现两函数**

在 `src/lib/user.ts` 顶部补 import（若缺）：`import { sql } from "drizzle-orm";`（`eq`/`db`/`users`/`AppError`/`isUniqueViolation` 已在文件内）。在文件末尾追加：

```ts
// 绑定当前用户的飞书身份。open_id 唯一——已被他人绑定则转译友好错误。
export async function bindFeishu(userId: string, input: { openId: string; name: string }) {
  try {
    await db
      .update(users)
      .set({ feishuOpenId: input.openId, feishuName: input.name, feishuBoundAt: sql`now()` })
      .where(eq(users.id, userId));
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("该飞书账号已绑定其他用户");
    throw e;
  }
}

export async function unbindFeishu(userId: string) {
  await db
    .update(users)
    .set({ feishuOpenId: null, feishuName: null, feishuBoundAt: null })
    .where(eq(users.id, userId));
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/user-feishu.test.ts`
Expected: PASS（三用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/user.ts tests/user-feishu.test.ts
git commit -m "feat: bindFeishu / unbindFeishu(open_id 唯一冲突转译)"
```

---

## Task 5: OAuth 路由 login + callback

**Files:**
- Create: `src/app/api/auth/feishu/login/route.ts`
- Create: `src/app/api/auth/feishu/callback/route.ts`

> 说明：OAuth 全链路真机验收在 Task 6 装好 UI 后一并做；本 task 只落路由，无自动化测试（回调依赖真实飞书授权码，离线不可造；逻辑分支已被 `feishu.ts`/`user.ts` 的单测覆盖）。

- [ ] **Step 1: 建 login 路由**

Create `src/app/api/auth/feishu/login/route.ts`:

```ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";

const BASE = process.env.FEISHU_BASE_URL ?? "https://open.feishu.cn";
const SITE = process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 发起飞书 OAuth：须已登录（绑定对象=当前 session 用户）。state 存 cookie 防 CSRF。
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", SITE));

  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("feishu_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  const authorize = new URL(`${BASE}/open-apis/authen/v1/authorize`);
  authorize.searchParams.set("app_id", process.env.FEISHU_APP_ID ?? "");
  authorize.searchParams.set("redirect_uri", process.env.FEISHU_REDIRECT_URI ?? "");
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}
```

- [ ] **Step 2: 建 callback 路由**

Create `src/app/api/auth/feishu/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/feishu";
import { bindFeishu } from "@/lib/user";
import { AppError } from "@/lib/errors";

const SITE = process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 回调：校 state → 取当前用户 → code 换 open_id → 绑定 → 回设置页带提示。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expected = store.get("feishu_oauth_state")?.value;
  store.delete("feishu_oauth_state");

  const settings = new URL("/settings", SITE);

  if (!code || !state || !expected || state !== expected) {
    settings.searchParams.set("feishu", "state_error");
    return NextResponse.redirect(settings);
  }

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", SITE));

  try {
    const { openId, name } = await exchangeOAuthCode(code);
    await bindFeishu(session.user.id, { openId, name });
    settings.searchParams.set("feishu", "bound");
  } catch (e) {
    settings.searchParams.set("feishu", e instanceof AppError ? "conflict" : "error");
    if (!(e instanceof AppError)) console.error("[feishu callback]", e);
  }
  return NextResponse.redirect(settings);
}
```

- [ ] **Step 3: 确认类型编译通过**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 4: 提交**

```bash
git add src/app/api/auth/feishu/
git commit -m "feat: 飞书 OAuth login/callback 路由(state 防 CSRF)"
```

---

## Task 6: 设置页飞书绑定卡片 + 真机绑定验收

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/feishu-card.tsx`

- [ ] **Step 1: 建绑定卡片 client 组件**

Create `src/app/(app)/settings/feishu-card.tsx`:

```tsx
"use client";

import { unbindFeishuAction } from "./page";

type Props = { boundName: string | null; boundAtLabel: string | null; notice: string | null };

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  bound: { text: "飞书绑定成功。", ok: true },
  state_error: { text: "绑定校验失败，请重试。", ok: false },
  conflict: { text: "该飞书账号已绑定其他用户。", ok: false },
  error: { text: "绑定失败，请稍后重试。", ok: false },
};

export function FeishuCard({ boundName, boundAtLabel, notice }: Props) {
  const n = notice ? NOTICE[notice] : null;
  return (
    <section className="ac-card space-y-3 p-5">
      <h2 className="font-display text-base font-semibold text-ink">飞书通知</h2>
      <p className="text-sm text-ink-soft">
        绑定飞书后，任务被指派、完成，以及临期/逾期时，你会收到飞书私信提醒。
      </p>
      {n && (
        <p className={`text-sm ${n.ok ? "text-emerald-600" : "text-red-600"}`}>{n.text}</p>
      )}
      {boundName ? (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-ink">
            已绑定：<span className="font-medium">{boundName}</span>
            {boundAtLabel && <span className="ml-2 text-ink-faint">（{boundAtLabel}）</span>}
          </div>
          <form action={unbindFeishuAction}>
            <button type="submit" className="ac-btn ac-btn-ghost text-sm">解绑</button>
          </form>
        </div>
      ) : (
        <a href="/api/auth/feishu/login" className="ac-btn ac-btn-primary inline-block text-sm">
          绑定飞书
        </a>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 建设置页 server 组件 + 解绑 action**

Create `src/app/(app)/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { unbindFeishu } from "@/lib/user";
import { FeishuCard } from "./feishu-card";

export async function unbindFeishuAction() {
  "use server";
  const session = await auth();
  if (!session?.user) redirect("/login");
  await unbindFeishu(session.user.id);
  revalidatePath("/settings");
}

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ feishu?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [row] = await db
    .select({ feishuName: users.feishuName, feishuBoundAt: users.feishuBoundAt })
    .from(users)
    .where(eq(users.id, session.user.id));
  const { feishu } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">设置</h1>
        <p className="text-sm text-ink-soft">账号与通知设置。个人访问令牌见「设置 → 令牌」。</p>
      </header>

      <FeishuCard
        boundName={row?.feishuName ?? null}
        boundAtLabel={fmt(row?.feishuBoundAt ?? null)}
        notice={feishu ?? null}
      />
    </main>
  );
}
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 4: 真机绑定验收**

Run: `npm run dev`（须 `.env` 有真实飞书凭证，且飞书应用后台已把 `FEISHU_REDIRECT_URI` 加入重定向白名单）。
浏览器登录后访问 `/settings` → 点「绑定飞书」→ 完成飞书授权 → 应跳回 `/settings?feishu=bound` 且显示「已绑定：<你的飞书名>」。
Expected: 绑定成功，库中该用户 `feishu_open_id` 非空。点「解绑」后卡片回到「绑定飞书」按钮。

- [ ] **Step 5: 提交**

```bash
git add "src/app/(app)/settings/"
git commit -m "feat: 设置页飞书绑定卡片 + 解绑 action"
```

---

## Task 7: 通知业务 notify.ts（fire-and-forget）

**Files:**
- Create: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/notify.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers";

// mock 飞书斥候：只验是否被调、收件人与文案
const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendTextMessage: (...a: unknown[]) => sendMock(...a) }));

async function base() {
  const owner = await createUser({ email: "owner@e.com", password: "password123", name: "主帅" });
  const team = await createTeam(owner.id, "东吴");
  const project = await createProject(owner.id, team.id, { name: "赤壁" });
  return { owner, team, project };
}

describe("notifyTaskAssigned", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("负责人已绑飞书 → 发私信", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "斥候", assigneeId: owner.id, dueDate: "2026-08-01" });

    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
    expect(String(sendMock.mock.calls[0][1])).toContain("斥候");
  });

  it("负责人未绑飞书 → 跳过", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id });
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("无负责人 → 跳过", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "x" });
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await notifyTaskAssigned(task);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("飞书发送抛错 → 不抛出（fire-and-forget）", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id });
    sendMock.mockRejectedValueOnce(new Error("飞书挂了"));
    const { notifyTaskAssigned } = await import("@/lib/notify");
    await expect(notifyTaskAssigned(task)).resolves.toBeUndefined();
  });
});

describe("notifyTaskCompleted", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("创建者≠操作者且已绑 → 通知创建者", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const doer = await createUser({ email: "doer@e.com", password: "password123", name: "小卒" });
    const task = await createTask(owner.id, project.id, { title: "攻城" });

    const { notifyTaskCompleted } = await import("@/lib/notify");
    await notifyTaskCompleted(task, doer.id);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
  });

  it("创建者=操作者 → 不发（免自我骚扰）", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const task = await createTask(owner.id, project.id, { title: "攻城" });
    const { notifyTaskCompleted } = await import("@/lib/notify");
    await notifyTaskCompleted(task, owner.id);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("scanAndNotifyDue", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("临期(明日)+逾期(昨日)按负责人聚合为一封", async () => {
    const { owner, project } = await base();
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    await createTask(owner.id, project.id, { title: "临期活", assigneeId: owner.id, dueDate: iso(tomorrow) });
    await createTask(owner.id, project.id, { title: "逾期活", assigneeId: owner.id, dueDate: iso(yesterday) });
    // done 的逾期任务不计
    const doneTask = await createTask(owner.id, project.id, { title: "已完成", assigneeId: owner.id, dueDate: iso(yesterday) });
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, doneTask.id));

    const { scanAndNotifyDue } = await import("@/lib/notify");
    const r = await scanAndNotifyDue();

    expect(sendMock).toHaveBeenCalledTimes(1); // 同一负责人一封
    const text = String(sendMock.mock.calls[0][1]);
    expect(text).toContain("临期活");
    expect(text).toContain("逾期活");
    expect(text).not.toContain("已完成");
    expect(r.notified).toBe(1);
  });

  it("未绑飞书的负责人 → 不发", async () => {
    const { owner, project } = await base();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await createTask(owner.id, project.id, { title: "x", assigneeId: owner.id, dueDate: tomorrow.toISOString().slice(0, 10) });
    const { scanAndNotifyDue } = await import("@/lib/notify");
    const r = await scanAndNotifyDue();
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.notified).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/notify.test.ts`
Expected: FAIL（`@/lib/notify` 不存在）。

- [ ] **Step 3: 实现 notify.ts**

Create `src/lib/notify.ts`:

```ts
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { sendTextMessage } from "./feishu";

type TaskRow = { id: string; title: string; dueDate: string | null; assigneeId: string | null; createdById?: string | null };

// 取用户 open_id（未绑返回 null）
async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget，通知不得阻断主业务）
async function safeSend(openId: string, text: string): Promise<boolean> {
  try {
    await sendTextMessage(openId, text);
    return true;
  } catch (e) {
    console.error("[notify] 飞书发送失败", e);
    return false;
  }
}

export async function notifyTaskAssigned(task: TaskRow): Promise<void> {
  if (!task.assigneeId) return;
  const openId = await openIdOf(task.assigneeId);
  if (!openId) return;
  const due = task.dueDate ? `（截止 ${task.dueDate}）` : "";
  await safeSend(openId, `【新任务】你被指派：${task.title}${due}`);
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, `【已完成】你创建的任务「${task.title}」已完成`);
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为日报。返回发送人数与扫描任务数。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  // 临期/逾期：status≠done 且 dueDate ≤ 明日（含逾期），且负责人已绑飞书
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      openId: users.feishuOpenId,
    })
    .from(tasks)
    .innerJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        isNotNull(users.feishuOpenId),
        // dueDate <= 明日（date 列与 CURRENT_DATE 比较）
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

  // 按负责人聚合
  const byUser = new Map<string, { openId: string; overdue: string[]; dueSoon: string[] }>();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    if (!r.assigneeId || !r.openId) continue;
    const bucket = byUser.get(r.assigneeId) ?? { openId: r.openId, overdue: [], dueSoon: [] };
    if (r.dueDate && r.dueDate < todayStr) bucket.overdue.push(r.title);
    else bucket.dueSoon.push(r.title);
    byUser.set(r.assigneeId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const lines: string[] = ["【任务提醒】"];
    if (overdue.length) lines.push(`逾期未完成：${overdue.join("、")}`);
    if (dueSoon.length) lines.push(`即将到期：${dueSoon.join("、")}`);
    const ok = await safeSend(openId, lines.join("\n"));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/notify.test.ts`
Expected: PASS（全部用例）。

> 注：`scanAndNotifyDue` 判「逾期 vs 临期」以 `dueDate < 今日` 分流，与 SQL 的 `<= 明日` 圈选一致（明日到期归 dueSoon，今日及以前归 overdue）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/notify.ts tests/notify.test.ts
git commit -m "feat: notify.ts 通知业务(assigned/completed/scanDue, fire-and-forget)"
```

---

## Task 8: task.ts 即时通知接入 + createTask/updateTask 收 tx

**Files:**
- Modify: `src/db/index.ts`（导出 `DbTx` 类型）
- Modify: `src/lib/task.ts`（createTask/updateTask 收 opts.tx + 非 tx 路径 fire 通知）
- Test: `tests/task-notify.test.ts`

- [ ] **Step 1: 导出事务类型**

查看 `src/db/index.ts` 现有导出。在其末尾追加（假设 `db` 在此定义/导出）：

```ts
// 事务连接类型：createTask/updateTask 等可选在事务内执行
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

若 `db` 不在 `index.ts` 而在别处，将此类型定义放到 `db` 所在文件并从 `@/db` re-export。

- [ ] **Step 2: 写失败测试（验即时通知被触发）**

Create `tests/task-notify.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { resetDb } from "./helpers";

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendTextMessage: (...a: unknown[]) => sendMock(...a) }));

async function base() {
  const owner = await createUser({ email: "o@e.com", password: "password123", name: "主帅" });
  const team = await createTeam(owner.id, "东吴");
  const project = await createProject(owner.id, team.id, { name: "赤壁" });
  await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
  return { owner, team, project };
}

describe("即时通知接入", () => {
  beforeEach(async () => { await resetDb(); sendMock.mockClear(); });

  it("建任务带负责人 → 发被指派通知", async () => {
    const { owner, project } = await base();
    await createTask(owner.id, project.id, { title: "斥候", assigneeId: owner.id });
    // fire-and-forget：给微任务队列一拍
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
  });

  it("改派 → 发被指派通知给新负责人", async () => {
    const { owner, project } = await base();
    const other = await createUser({ email: "x@e.com", password: "password123", name: "副将" });
    await bindFeishu(other.id, { openId: "ou_other", name: "副将" });
    const task = await createTask(owner.id, project.id, { title: "布阵" });
    sendMock.mockClear();

    await updateTask(owner.id, task.id, { assigneeId: other.id });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMock.mock.calls.some((c) => c[0] === "ou_other")).toBe(true);
  });

  it("owner 自建自完成 → 不发完成通知（创建者=操作者）", async () => {
    const { owner, project } = await base();
    const task = await createTask(owner.id, project.id, { title: "攻城" });
    sendMock.mockClear();

    await updateTask(owner.id, task.id, { status: "done", completionNote: "克" });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

> 说明：末例创建者=操作者=owner，验证「自我操作不通知」。跨人完成通知的正例由 `tests/notify.test.ts` 的 `notifyTaskCompleted` 单测覆盖（直接调 notify，隔离更干净），此处不重复搭多成员权限场景（YAGNI）。

- [ ] **Step 3: 跑测试验证失败**

Run: `npm test -- tests/task-notify.test.ts`
Expected: 第 1、2 例 FAIL（createTask/updateTask 尚未 fire 通知）。

- [ ] **Step 4: 改 task.ts —— 收 tx + fire 通知**

在 `src/lib/task.ts` 顶部 import 补：

```ts
import { db } from "@/db";
import type { DbTx } from "@/db";
import { notifyTaskAssigned, notifyTaskCompleted } from "./notify";
```

（`db` 若已 import 则不重复。）

改 `createTask` 签名与实现——加末参 `opts`，执行器取 `opts?.tx ?? db`，非 tx 路径才 fire 通知：

```ts
export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const access = await requireTaskWrite(actorId, projectId);
  if (input.assigneeId) await validateAssignee(access.project.teamId, input.assigneeId);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);

  const [task] = await exec
    .insert(tasks)
    .values({
      projectId,
      createdById: actorId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      startDate: input.startDate,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      priority: input.priority ?? "medium",
      sortOrder: Date.now(),
    })
    .returning();

  // 非事务路径：即时通知（fire-and-forget，通知内部已吞异常）。事务路径由调用方提交后补发。
  if (!opts?.tx && task.assigneeId) void notifyTaskAssigned(task);
  return task;
}
```

改 `updateTask` ——加末参 `opts`，执行器取 `opts?.tx ?? db`，读旧任务与写均走 exec；非 tx 路径按变更 fire：

```ts
export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completionNote?: string | null;
  },
  opts?: { tx?: DbTx },
) {
  const exec = opts?.tx ?? db;
  const [task] = await exec.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);
  if (patch.assigneeId) await validateAssignee(access.project.teamId, patch.assigneeId);
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);

  const [updated] = await exec
    .update(tasks)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.assigneeId !== undefined && { assigneeId: patch.assigneeId }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.milestoneId !== undefined && { milestoneId: patch.milestoneId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  if (!opts?.tx) {
    // 改派：通知新负责人
    if (patch.assigneeId && patch.assigneeId !== task.assigneeId) void notifyTaskAssigned(updated);
    // 完成：通知创建者(≠操作者)
    if (patch.status === "done" && task.status !== "done") void notifyTaskCompleted(updated, actorId);
  }
  return updated;
}
```

- [ ] **Step 5: 跑测试验证通过**

Run: `npm test -- tests/task-notify.test.ts && npm test -- tests/task.test.ts`
Expected: PASS（新旧全绿）。

- [ ] **Step 6: 全量回归**

Run: `npm test`
Expected: 全绿。既有测试多不 mock feishu，但其 createTask 用的负责人多未绑飞书 → 通知静默跳过（不发真网络）；`void` 不 await，异常已被 notify 内部吞。

> 若某未 mock feishu 的测试因 `void notifyTaskAssigned` 触发真实 fetch 报错日志：无妨（不阻断、不抛出）。若欲洁净，可在 `tests/setup.ts` 顶部加全局 mock：`vi.mock("@/lib/feishu", () => ({ sendTextMessage: vi.fn(), getTenantAccessToken: vi.fn(), exchangeOAuthCode: vi.fn() }));`——但这会与 `tests/feishu.test.ts`（需真实 feishu）冲突。**决策：不做全局 mock**，各 test 文件按需自行 `vi.mock`，`tests/feishu.test.ts` 保持真实。

- [ ] **Step 7: 提交**

```bash
git add src/db/index.ts src/lib/task.ts tests/task-notify.test.ts
git commit -m "feat: createTask/updateTask 收 tx + 即时飞书通知接入"
```

---

## Task 9: commitDraft 事务化 + 提交后补发通知

**Files:**
- Modify: `src/lib/agent/commit.ts`
- Test: `tests/agent-commit.test.ts`（追加事务回滚用例）

- [ ] **Step 1: 写失败测试（中途失败整体回滚）**

在 `tests/agent-commit.test.ts` 末尾追加（顶部按需补 import：`db`/`tasks`/`eq`/`listProjectTasks`）：

```ts
describe("commitDraft 事务化", () => {
  beforeEach(resetDb);

  it("decompose 中途非法 → 整批回滚(无残留)", async () => {
    // 构造：第 2 个任务 milestoneId 非法 → validateMilestone 抛错 → 整批回滚
    const owner = await createUser({ email: "o@e.com", password: "password123", name: "o" });
    const team = await createTeam(owner.id, "T");
    const project = await createProject(owner.id, team.id, { name: "P" });

    const draft = {
      tasks: [
        { title: "合法一" },
        { title: "非法二", milestoneId: "00000000-0000-0000-0000-000000000000" },
      ],
    };
    await expect(
      commitDraft(owner.id, project.id, "decompose_tasks", draft),
    ).rejects.toThrow();

    const after = await listProjectTasks(owner.id, project.id);
    expect(after).toHaveLength(0); // 「合法一」不得残留
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/agent-commit.test.ts`
Expected: 新用例 FAIL（当前无事务，「合法一」已落库 → length 1）。

- [ ] **Step 3: commitDraft 三分支裹事务 + 提交后补发**

改 `src/lib/agent/commit.ts`。顶部 import 补：

```ts
import { db } from "@/db";
import { notifyTaskAssigned, notifyTaskCompleted } from "@/lib/notify";
```

将 `decompose_tasks`、`update_tasks`、`plan_sprint` 三分支改为事务包裹，事务外补发通知：

```ts
    case "decompose_tasks": {
      const d = decomposeSchema.parse(draft);
      const created = await db.transaction(async (tx) => {
        const out = [];
        for (const t of d.tasks) out.push(await createTask(actorId, projectId, t, { tx }));
        return out;
      });
      for (const t of created) if (t.assigneeId) void notifyTaskAssigned(t);
      return { committed: d.tasks.length, conflicts: [] };
    }
    case "update_tasks": {
      const d = updateTasksSchema.parse(draft);
      const current = await listProjectTasks(actorId, projectId);
      const versionOf = new Map(current.map((r) => [r.id, r.updatedAt.toISOString()]));
      const prevStatus = new Map(current.map((r) => [r.id, r.status]));
      const conflicts: string[] = [];
      const toApply = d.updates.filter((u) => {
        if (versionOf.get(u.taskId) !== u.updatedAt) { conflicts.push(u.taskId); return false; }
        return true;
      });
      const updatedRows = await db.transaction(async (tx) => {
        const out = [];
        for (const u of toApply) out.push(await updateTask(actorId, u.taskId, u.patch, { tx }));
        return out;
      });
      for (const t of updatedRows) {
        if (t.status === "done" && prevStatus.get(t.id) !== "done") void notifyTaskCompleted(t, actorId);
      }
      return { committed: updatedRows.length, conflicts };
    }
    case "plan_sprint": {
      const d = planSprintSchema.parse(draft);
      await db.transaction(async (tx) => {
        for (const id of d.taskIds)
          await updateTask(actorId, id, { milestoneId: d.milestoneId, dueDate: d.dueDate }, { tx });
      });
      return { committed: d.taskIds.length, conflicts: [] };
    }
```

> `create_project` 分支不含批量任务落库，保持原样。`update_tasks` 仅补发完成通知（sprint/更新场景以完成为主）；改派通知留即时路径（网页/CC 直接调 updateTask 时已覆盖），MVP 不在批量确认里补发改派。

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/agent-commit.test.ts`
Expected: PASS（回滚用例 + 既有用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/agent/commit.ts tests/agent-commit.test.ts
git commit -m "fix: commitDraft 批量落库事务化 + 提交后补发通知(还技术债)"
```

---

## Task 10: 定时提醒端点 /api/cron/reminders

**Files:**
- Create: `src/app/api/cron/reminders/route.ts`
- Test: `tests/cron-reminders.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/cron-reminders.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUser, bindFeishu } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { POST as cronRoute } from "@/app/api/cron/reminders/route";
import { resetDb } from "./helpers";

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendTextMessage: (...a: unknown[]) => sendMock(...a) }));

function req(secret?: string) {
  return new Request("http://test/api/cron/reminders", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST /api/cron/reminders", () => {
  beforeEach(async () => {
    await resetDb();
    sendMock.mockClear();
    vi.stubEnv("CRON_SECRET", "cron-xyz");
  });

  it("缺 secret → 401", async () => {
    const res = await cronRoute(req());
    expect(res.status).toBe(401);
  });

  it("错 secret → 401", async () => {
    const res = await cronRoute(req("wrong"));
    expect(res.status).toBe(401);
  });

  it("对 secret → 扫描并发提醒", async () => {
    const owner = await createUser({ email: "o@e.com", password: "password123", name: "主帅" });
    const team = await createTeam(owner.id, "东吴");
    const project = await createProject(owner.id, team.id, { name: "赤壁" });
    await bindFeishu(owner.id, { openId: "ou_owner", name: "主帅" });
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await createTask(owner.id, project.id, { title: "临期活", assigneeId: owner.id, dueDate: tomorrow.toISOString().slice(0, 10) });

    const res = await cronRoute(req("cron-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notified).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/cron-reminders.test.ts`
Expected: FAIL（路由不存在）。

- [ ] **Step 3: 建 cron 路由**

Create `src/app/api/cron/reminders/route.ts`:

```ts
import { NextResponse } from "next/server";
import { scanAndNotifyDue } from "@/lib/notify";

// 定时提醒端点：外部调度每日打一次。CRON_SECRET 为唯一护栏。
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() : null;
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const result = await scanAndNotifyDue();
    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/cron/reminders]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/cron-reminders.test.ts`
Expected: PASS（三用例）。

- [ ] **Step 5: 补部署调度说明到 docs/agent-api.md**

在 `docs/agent-api.md` 末尾追加一节：

```markdown
## 定时提醒（cron）

`POST /api/cron/reminders` 由外部调度每日打一次，扫临期/逾期任务并飞书私信负责人。以 `CRON_SECRET` 鉴权：

    curl -X POST "$AGILECAMPUS_URL/api/cron/reminders" -H "Authorization: Bearer $CRON_SECRET"

NAS 部署可用 host crontab（每日 09:00）：

    0 9 * * * curl -fsS -X POST "http://localhost:3000/api/cron/reminders" -H "Authorization: Bearer <CRON_SECRET>" >/dev/null 2>&1
```

- [ ] **Step 6: 全量回归 + 提交**

Run: `npm test`
Expected: 全绿。

```bash
git add src/app/api/cron/reminders/ tests/cron-reminders.test.ts docs/agent-api.md
git commit -m "feat: 定时提醒端点 /api/cron/reminders(CRON_SECRET 鉴权) + 部署说明"
```

---

## 收尾：更新技术债备案

- [ ] **Step 1: 勾销「批量落库非事务」债 + 记飞书简化备案**

在 `docs/BACKLOG.md` 中：将「批量落库非事务」条目标注 `[已偿·图七]`；在末尾追加「## 图七（飞书接入）简化备案」，摘录 spec §7 要点（cron 无当日去重、纯文本无卡片、未做飞书事件订阅、token 进程内缓存、scanDue 全库扫描、日报仅按 assignee 聚合、update_tasks 批量确认不补发改派通知）。

- [ ] **Step 2: 提交**

```bash
git add docs/BACKLOG.md
git commit -m "docs: 图七收尾——勾销事务化债 + 飞书简化备案"
```

---

## Self-Review 记录（计划编写时自查）

- **Spec 覆盖**：§2 数据模型→Task1；§3.1 斥候→Task2/3；§3.2 OAuth→Task5；§3.3 UI→Task6；§3.4 notify→Task7；§3.5 即时接入→Task8；§3.6 cron→Task10；§4 事务化→Task9；§5 安全（state/CRON_SECRET/fire-forget/未绑静默）分散于 Task5/7/10；§6 测试→各 task 内含；§7 简化备案→收尾。全覆盖。
- **Placeholder**：飞书端点已给具体 URL/payload，另设 Task3-Step5 核验关口，非 placeholder。
- **类型一致**：`createTask(actorId, projectId, input, opts?)`、`updateTask(actorId, taskId, patch, opts?)`、`DbTx`、`notifyTaskAssigned(task)`、`notifyTaskCompleted(task, actorId)`、`scanAndNotifyDue(): {notified, tasksScanned}`、`sendTextMessage(openId, text)`、`exchangeOAuthCode(code): {openId, name}`、`getTenantAccessToken()` —— 各 task 前后一致。
- **依赖顺序**：Task1(schema)→2/3(斥候)→4(绑定 lib)→5(路由)→6(UI 真机)→7(notify，依赖斥候)→8(接入，依赖 notify+DbTx)→9(事务化，依赖 tx 参数)→10(cron，依赖 scanDue)→收尾。无逆序依赖。
