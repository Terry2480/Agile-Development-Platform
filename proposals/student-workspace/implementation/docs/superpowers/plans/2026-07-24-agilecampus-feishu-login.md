# 飞书登录 实施计划（Plan A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AgileCampus 支持以飞书身份登录——OAuth 按钮（内外通用）+ JSSDK 免登（飞书客户端内静默），已绑账号登录之、未绑自动建号。

**Architecture:** 新增单个 NextAuth `Credentials` provider `"feishu"`，OAuth 与 JSSDK 两路皆归结为「拿飞书 code → `signIn("feishu",{code})`」；provider `authorize` 内 `exchangeOAuthCode(code)→openId`，命中登录、未命中建号。现有邮箱密码登录与设置页绑定路径不动。

**Tech Stack:** Next.js 16 (App Router) · Auth.js v5 (Credentials) · Drizzle ORM + PostgreSQL · 飞书 OAuth + JSSDK 网页应用免登 · Vitest

---

## 前置说明（executor 必读）

- schema 用 `npm run db:push`（dev 库）+ `npm run db:push:test`（test 库），非 migrate。本 plan **不改 schema**。
- 测试：`npm test`（= `dotenv -e .env.test -- vitest run`）。单文件：`npm test -- tests/xxx.test.ts`。
- 错误约定（`src/lib/errors.ts`）：`AppError`、`isUniqueViolation(e)`。
- 飞书凭证在 `.env`：`FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_REDIRECT_URI`/`FEISHU_BASE_URL`/`AGILECAMPUS_URL`。`.env.test` 无飞书凭证——飞书测试用 `vi.stubEnv` + mock fetch。
- 现有 `feishu.ts` 已有 `getTenantAccessToken`/`exchangeOAuthCode(code):{openId,name}`/`sendTextMessage`，内部有 `BASE()` 辅助与 `tokenCache`。
- 现有 `user.ts` 有 `createUser`/`bindFeishu`/`unbindFeishu`；`password.ts` 有 `hashPassword`/`verifyPassword`（bcrypt）。
- `users` 表：`email` notNull+unique、`passwordHash` notNull、`name` notNull、`feishuOpenId` unique（可空）、`feishuName`、`feishuBoundAt`。
- 现有 `auth.ts`：`export const { handlers, auth, signIn, signOut } = NextAuth({ providers:[Credentials({邮箱密码})], ... })`。
- **飞书 API 核验**：JSSDK ticket 端点、签名串格式、`tt.requestAuthCode` API 名，实现前以飞书开放平台官方文档核验；如有出入仅调 URL/字段、不改本计划函数签名与测试。

---

## Task 1: findOrCreateByFeishu（混合建号）

**Files:**
- Modify: `src/lib/user.ts`
- Test: `tests/user-feishu.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `tests/user-feishu.test.ts` 末尾追加（顶部若未 import 则补 `import { findOrCreateByFeishu } from "@/lib/user";`；`db`/`users`/`eq`/`createUser`/`bindFeishu`/`resetDb` 该文件已 import）：

```ts
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/user-feishu.test.ts`
Expected: FAIL（`findOrCreateByFeishu` 未导出）。

- [ ] **Step 3: 实现 findOrCreateByFeishu**

在 `src/lib/user.ts` 顶部补 import：`import { randomBytes } from "node:crypto";`。文件末尾追加：

```ts
// 飞书登录的账号解析：已绑 openId → 返回原账号；未绑 → 自动建号（占位 email + 不可用 hash，禁邮箱登录）。
export async function findOrCreateByFeishu(input: { openId: string; name: string }) {
  const [existing] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.feishuOpenId, input.openId));
  if (existing) return existing;

  const email = `${input.openId.toLowerCase()}@feishu.local`;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  try {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name: input.name,
        feishuOpenId: input.openId,
        feishuName: input.name,
        feishuBoundAt: sql`now()`,
      })
      .returning({ id: users.id, email: users.email, name: users.name });
    return user;
  } catch (e) {
    // 并发：另一请求已为同一 openId 抢先建号 → 回查复用
    if (isUniqueViolation(e)) {
      const [u] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.feishuOpenId, input.openId));
      if (u) return u;
    }
    throw e;
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/user-feishu.test.ts`
Expected: PASS（新旧全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/user.ts tests/user-feishu.test.ts
git commit -m "feat: findOrCreateByFeishu 混合建号(占位 email + 不可用 hash)"
```

---

## Task 2: loginWithFeishuCode + feishu Credentials provider

**Files:**
- Modify: `src/lib/user.ts`（加 `loginWithFeishuCode`）
- Modify: `src/lib/auth.ts`（加 feishu provider）
- Test: `tests/feishu-login.test.ts`

- [ ] **Step 1: 写失败测试（测可测的 loginWithFeishuCode）**

Create `tests/feishu-login.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/feishu-login.test.ts`
Expected: FAIL（`loginWithFeishuCode` 未导出）。

- [ ] **Step 3: 实现 loginWithFeishuCode**

`src/lib/user.ts` 顶部已在 Task1 import 了 feishu 相关？否。在 `src/lib/user.ts` 顶部补 import：`import { exchangeOAuthCode } from "./feishu";`。文件末尾追加：

```ts
// 飞书登录归一入口：一次性 code → openId → 找/建账号。OAuth 与 JSSDK 两路共用。
export async function loginWithFeishuCode(code: string) {
  const { openId, name } = await exchangeOAuthCode(code);
  return findOrCreateByFeishu({ openId, name });
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/feishu-login.test.ts`
Expected: PASS（两用例）。

- [ ] **Step 5: auth.ts 加 feishu provider**

在 `src/lib/auth.ts` 顶部补 import：`import { loginWithFeishuCode } from "@/lib/user";`。在 `providers` 数组的现有 `Credentials({...})`（邮箱密码）之后，追加第二个 provider：

```ts
    Credentials({
      id: "feishu",
      credentials: { code: {} },
      authorize: async (credentials) => {
        const code = credentials?.code;
        if (typeof code !== "string" || !code) return null;
        try {
          const user = await loginWithFeishuCode(code);
          return { id: user.id, email: user.email, name: user.name };
        } catch {
          return null; // code 失效/飞书故障 → 登录失败（NextAuth 转 CredentialsSignin）
        }
      },
    }),
```

- [ ] **Step 6: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 7: 提交**

```bash
git add src/lib/user.ts src/lib/auth.ts tests/feishu-login.test.ts
git commit -m "feat: loginWithFeishuCode + feishu Credentials provider(两路归一)"
```

---

## Task 3: OAuth 登录路 — login/callback 改造 + 登录页按钮

**Files:**
- Modify: `src/app/api/auth/feishu/login/route.ts`（去 session 强制，登录/绑定通用）
- Modify: `src/app/api/auth/feishu/callback/route.ts`（无 session→登录，有 session→绑定）
- Create: `src/app/(auth)/login/feishu-login.tsx`
- Modify: `src/app/(auth)/login/page.tsx`（嵌入按钮）

> 说明：OAuth 全链路依赖真实飞书授权码，离线不可自动化；本 task 逻辑分支已被 `loginWithFeishuCode`（Task 2）单测覆盖，故只落代码 + 编译检查 + 真机验收。

- [ ] **Step 1: 改 login route —— 去掉 session 强制**

将 `src/app/api/auth/feishu/login/route.ts` 全文替换为：

```ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BASE = process.env.FEISHU_BASE_URL ?? "https://open.feishu.cn";

// 发起飞书 OAuth——登录与绑定共用。无论是否已登录皆可发起；用途由 callback 按 session 有无分流。
export async function GET() {
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

- [ ] **Step 2: 改 callback route —— 无 session 则登录**

将 `src/app/api/auth/feishu/callback/route.ts` 全文替换为：

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { auth, signIn } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/feishu";
import { bindFeishu } from "@/lib/user";
import { AppError } from "@/lib/errors";

const SITE = process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 回调：校 state → 有 session 则绑定当前用户，无 session 则以此 code 飞书登录。
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

  if (session?.user) {
    // 已登录 → 绑定（自己 exchange，code 只用一次）
    try {
      const { openId, name } = await exchangeOAuthCode(code);
      await bindFeishu(session.user.id, { openId, name });
      settings.searchParams.set("feishu", "bound");
    } catch (e) {
      settings.searchParams.set("feishu", e instanceof AppError ? "conflict" : "error");
      if (!(e instanceof AppError)) console.error("[feishu callback bind]", e);
    }
    return NextResponse.redirect(settings);
  }

  // 未登录 → 飞书登录：把 code 交给 provider（authorize 内 exchange），signIn 抛 redirect 上抛
  try {
    await signIn("feishu", { code, redirectTo: "/teams" });
  } catch (e) {
    if (isRedirectError(e)) throw e; // 登录成功的 redirect 必须上抛
    const login = new URL("/login", SITE);
    login.searchParams.set("feishu", "login_error");
    return NextResponse.redirect(login);
  }
}
```

- [ ] **Step 3: 建登录按钮组件**

Create `src/app/(auth)/login/feishu-login.tsx`:

```tsx
"use client";

// 飞书登录入口。OAuth 路：跳 /api/auth/feishu/login 发起授权。
// （JSSDK 免登在 Task 4 补入此组件。）
export function FeishuLogin() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        或
        <span className="h-px flex-1 bg-line" />
      </div>
      <a href="/api/auth/feishu/login" className="ac-btn ac-btn-ghost block w-full text-center">
        飞书登录
      </a>
    </div>
  );
}
```

- [ ] **Step 4: 登录页嵌入按钮**

在 `src/app/(auth)/login/page.tsx` 顶部 import 加 `import { FeishuLogin } from "./feishu-login";`。在 `LoginForm` 的「没有账号？去注册」`<p>` 之后、`</main>` 之前插入 `<FeishuLogin />`：

```tsx
      <p className="text-sm text-ink-soft">
        没有账号？<Link href="/register" className="text-primary hover:underline">去注册</Link>
      </p>
      <FeishuLogin />
    </main>
```

- [ ] **Step 5: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误。若 `next/dist/client/components/redirect-error` 路径在本 Next 版本不存在，改用 `next/navigation` 的 `isRedirectError`（若导出），或 catch 后重抛任何 `digest?.startsWith("NEXT_REDIRECT")` 的错误——以 `node_modules/next/dist` 实际导出为准（AGENTS.md：先查 Next 文档/导出）。

- [ ] **Step 6: 真机验收**

`npm run dev`（.env 具真实飞书凭证 + 后台重定向白名单含完整 `FEISHU_REDIRECT_URI`）。登出后访问 `/login` → 点「飞书登录」→ 飞书授权 → 应建 session 并落 `/teams`。已登录时于 `/settings` 点「绑定飞书」仍走绑定（回 `/settings?feishu=bound`），两路互不干扰。

- [ ] **Step 7: 提交**

```bash
git add src/app/api/auth/feishu/ "src/app/(auth)/login/"
git commit -m "feat: 飞书 OAuth 登录路(callback 按 session 分流登录/绑定) + 登录页按钮"
```

---

## Task 4: JSSDK 免登（飞书客户端内静默登录）

**Files:**
- Modify: `src/lib/feishu.ts`（`getJsapiTicket` + `buildJsapiSignature`）
- Create: `src/app/api/feishu/jssdk-config/route.ts`
- Modify: `src/app/(auth)/login/feishu-login.tsx`（免登分支）
- Test: `tests/feishu-jssdk.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/feishu-jssdk.test.ts`:

```ts
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
      // 第一打：tenant_access_token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "t-abc", expire: 7200 }), { status: 200 }),
      )
      // 第二打：jsapi ticket
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { ticket: "tk-1", expire_in: 7200 } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getJsapiTicket } = await import("@/lib/feishu");
    expect(await getJsapiTicket()).toBe("tk-1");
    expect(await getJsapiTicket()).toBe("tk-1");
    // token+ticket 各一次；第二次 getJsapiTicket 命中缓存不再打
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/feishu-jssdk.test.ts`
Expected: FAIL（`getJsapiTicket`/`buildJsapiSignature` 未导出）。

- [ ] **Step 3: 实现 getJsapiTicket + 签名**

在 `src/lib/feishu.ts` 顶部补 import：`import { createHash } from "node:crypto";`。文件末尾追加：

```ts
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
```

> 注：`BASE()` 与 `getTenantAccessToken` 已在 `feishu.ts` 定义，直接复用。`/open-apis/jssdk/ticket/get` 的请求方法与响应结构以飞书官方文档核验。

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/feishu-jssdk.test.ts`
Expected: PASS（两用例）。

- [ ] **Step 5: 建 jssdk-config 端点**

Create `src/app/api/feishu/jssdk-config/route.ts`:

```ts
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getJsapiTicket, buildJsapiSignature } from "@/lib/feishu";

// 前端 JSSDK 鉴权签名签发。入参 url=当前页面完整 URL（不含 #fragment）。
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "缺 url" }, { status: 400 });

  try {
    const ticket = await getJsapiTicket();
    const nonceStr = randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const signature = buildJsapiSignature({ ticket, nonceStr, timestamp, url });
    return NextResponse.json({
      appId: process.env.FEISHU_APP_ID ?? "",
      timestamp,
      nonceStr,
      signature,
    });
  } catch (e) {
    console.error("[feishu jssdk-config]", e);
    return NextResponse.json({ error: "签名失败" }, { status: 500 });
  }
}
```

- [ ] **Step 6: FeishuLogin 加免登分支**

将 `src/app/(auth)/login/feishu-login.tsx` 全文替换为：

```tsx
"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

// 飞书 JSSDK 全局（运行时由飞书客户端注入 window.h5sdk / window.tt）
declare global {
  interface Window {
    h5sdk?: {
      config: (c: {
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
        onSuccess?: () => void;
        onFail?: (e: unknown) => void;
      }) => void;
      ready: (cb: () => void) => void;
      error: (cb: (e: unknown) => void) => void;
    };
    tt?: {
      requestAuthCode: (o: {
        appId: string;
        success: (res: { code: string }) => void;
        fail: (e: unknown) => void;
      }) => void;
    };
  }
}

export function FeishuLogin() {
  const [status, setStatus] = useState<"idle" | "silent" | "failed">("idle");

  useEffect(() => {
    // 非飞书环境（无 h5sdk）→ 保持 idle，显示 OAuth 按钮
    if (typeof window === "undefined" || !window.h5sdk) return;
    setStatus("silent");

    const pageUrl = window.location.href.split("#")[0];
    (async () => {
      try {
        const res = await fetch(`/api/feishu/jssdk-config?url=${encodeURIComponent(pageUrl)}`);
        if (!res.ok) throw new Error("config fetch failed");
        const cfg = (await res.json()) as {
          appId: string; timestamp: number; nonceStr: string; signature: string;
        };
        window.h5sdk!.config({
          ...cfg,
          onFail: () => setStatus("failed"),
        });
        window.h5sdk!.error(() => setStatus("failed"));
        window.h5sdk!.ready(() => {
          window.tt!.requestAuthCode({
            appId: cfg.appId,
            success: async ({ code }) => {
              await signIn("feishu", { code, redirectTo: "/teams" });
            },
            fail: () => setStatus("failed"),
          });
        });
      } catch {
        setStatus("failed");
      }
    })();
  }, []);

  // 飞书内免登进行中：提示，不显示按钮
  if (status === "silent") {
    return <p className="text-center text-sm text-ink-soft">正在通过飞书登录…</p>;
  }

  // 非飞书环境 或 免登失败 → OAuth 按钮兜底
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        或
        <span className="h-px flex-1 bg-line" />
      </div>
      {status === "failed" && (
        <p className="text-center text-xs text-high">飞书免登失败，请点下方按钮</p>
      )}
      <a href="/api/auth/feishu/login" className="ac-btn ac-btn-ghost block w-full text-center">
        飞书登录
      </a>
    </div>
  );
}
```

- [ ] **Step 7: 编译检查 + 全量回归**

Run: `npx tsc --noEmit && npm test`
Expected: 无类型错误；全测试绿（新单测 + 既有）。

- [ ] **Step 8: 真机验收（飞书客户端内）**

飞书后台开通「网页应用」能力、配置主页 URL 为登录页地址。于飞书客户端内打开该网页应用 → 应自动静默登录落 `/teams`（无需点按钮）。外部浏览器打开 `/login` → 显示「飞书登录」按钮走 OAuth。

- [ ] **Step 9: 提交**

```bash
git add src/lib/feishu.ts src/app/api/feishu/ "src/app/(auth)/login/feishu-login.tsx" tests/feishu-jssdk.test.ts
git commit -m "feat: 飞书 JSSDK 免登(getJsapiTicket+签名端点+前端静默登录)"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 provider 归一→Task2；§3.2 两路→Task3(OAuth)+Task4(JSSDK)；§3.3 混合建号→Task1；§3.4 JSSDK→Task4；§3.5 绑定保留→Task3 callback 分流保留绑定；§3.6 文件全覆盖。卡片(§4)属 Plan B。
- **类型一致**：`findOrCreateByFeishu({openId,name})`、`loginWithFeishuCode(code)`、`getJsapiTicket()`、`buildJsapiSignature({ticket,nonceStr,timestamp,url})`、provider id `"feishu"` credentials `{code}` —— 各 task 前后一致。
- **依赖顺序**：Task1(建号)→2(provider，依赖建号+exchangeOAuthCode)→3(OAuth 路，依赖 provider)→4(JSSDK，依赖 provider + feishu.ts)。无逆序。
- **Placeholder**：飞书端点/签名串已给具体实现 + 核验关口（Task4 Step3 注、前置说明），非占位。
- **核验关口**：`isRedirectError` 导入路径（Task3 Step5）、jsapi ticket 端点与签名串（Task4）以 Next/飞书实际为准。
