# AgileCampus 作战图一：地基（脚手架 + 账号 + 团队 + 权限）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 AgileCampus 的项目脚手架与"地基"层——邮箱密码注册登录、团队与邀请码、admin/teacher/student 三角色权限，全部经测试验证并可 Docker 本地运行。

**Architecture:** Next.js（App Router）单体全栈应用，PostgreSQL + Drizzle ORM 持久化，Auth.js（next-auth v5）Credentials 登录（JWT 会话），权限判定收敛在 `requireTeamRole()` 一个函数。业务逻辑放在 `src/lib/*.ts` 纯函数中（可直接测试），Server Actions 只做薄封装。

**Tech Stack:** Next.js 15+ / TypeScript / Tailwind CSS / PostgreSQL 16 / Drizzle ORM / next-auth@5(beta) / bcryptjs / Zod / nanoid / Vitest / Docker Compose

**设计文档：** `docs/superpowers/specs/2026-07-02-agilecampus-mvp-design.md`（第 2 节"地基"、第 4 节数据模型前三表、第 5 节权限模型）

---

## 文件结构总览

```
docker-compose.yml                    # 开发用 Postgres（含测试库初始化）
scripts/init-test-db.sql              # 创建 agilecampus_test 测试库
.env.example / .env / .env.test       # 环境变量
drizzle.config.ts                     # Drizzle Kit 配置
vitest.config.ts                      # 测试配置
src/db/index.ts                       # Drizzle 客户端（唯一 DB 入口）
src/db/schema.ts                      # users / teams / team_members
src/lib/password.ts                   # 密码哈希与校验
src/lib/errors.ts                     # AppError / ForbiddenError
src/lib/user.ts                       # createUser（注册核心逻辑）
src/lib/team.ts                       # createTeam / joinTeam / requireTeamRole / updateMemberRole
src/lib/auth.ts                       # Auth.js 配置（Credentials + JWT）
src/types/next-auth.d.ts              # session.user.id 类型补全
src/app/api/auth/[...nextauth]/route.ts
src/app/(auth)/register/{page.tsx,actions.ts}
src/app/(auth)/login/{page.tsx,actions.ts}
src/app/(app)/layout.tsx              # 受保护布局（未登录重定向）
src/app/(app)/teams/{page.tsx,actions.ts,team-forms.tsx}
src/app/(app)/teams/[teamId]/members/{page.tsx,actions.ts}
tests/setup.ts                        # 加载 .env.test
tests/helpers.ts                      # 测试数据清理工具
tests/password.test.ts
tests/user.test.ts
tests/team.test.ts
```

约定：`@/` 别名指向 `src/`。所有业务函数抛出的可预期错误使用 `Error` 子类（`AppError`），Server Action 捕获后转为表单错误消息，绝不静默失败。

---

### Task 1: 项目脚手架

**Files:**
- Create: 整个 Next.js 项目（create-next-app 生成）
- Create: `vitest.config.ts`
- Modify: `package.json`（scripts）

- [ ] **Step 1: 生成 Next.js 项目**

在仓库根目录（已有 docs/ 与 .git，故用 `.` 且允许非空）：

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

Expected: 生成 `src/app/` 等目录，`package.json` 出现 next/react 依赖。若因目录非空报错，先临时移走 `docs/` 再移回。

- [ ] **Step 2: 安装依赖**

```bash
npm install drizzle-orm postgres next-auth@beta bcryptjs zod nanoid
npm install -D drizzle-kit vitest dotenv dotenv-cli @types/bcryptjs
```

Expected: 无 peer-dependency 报错（若 next-auth@beta 与 Next 版本有 peer 警告，记录但可继续）。

- [ ] **Step 3: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false, // 共享测试库，串行执行避免数据互踩
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 4: 在 `package.json` 的 scripts 中加入**

```json
{
  "scripts": {
    "db:push": "drizzle-kit push",
    "db:push:test": "dotenv -e .env.test -- drizzle-kit push",
    "test": "dotenv -e .env.test -- vitest run"
  }
}
```

（保留 create-next-app 生成的 dev/build/start/lint 脚本。）

- [ ] **Step 5: 验证与提交**

```bash
npm run dev -- --port 3100 &
sleep 5 && curl -sf http://localhost:3100 > /dev/null && echo OK
kill %1
git add -A && git commit -m "chore: Next.js 脚手架与测试工具链"
```

Expected: 输出 `OK`。

---

### Task 2: Postgres 与环境变量

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/init-test-db.sql`
- Create: `.env.example`、`.env`、`.env.test`
- Modify: `.gitignore`（确保 `.env.example` 可提交）

- [ ] **Step 1: 创建 `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: agilecampus
      POSTGRES_PASSWORD: agilecampus_dev
      POSTGRES_DB: agilecampus
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql
volumes:
  pgdata:
```

- [ ] **Step 2: 创建 `scripts/init-test-db.sql`**

```sql
CREATE DATABASE agilecampus_test;
```

- [ ] **Step 3: 创建 `.env.example`（提交）**

```bash
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus
AUTH_SECRET=change-me-run-npx-auth-secret
```

复制生成 `.env`（同内容，AUTH_SECRET 用 `openssl rand -base64 32` 生成真值）；创建 `.env.test`：

```bash
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus_test
AUTH_SECRET=test-secret-not-for-production
```

- [ ] **Step 4: 检查 `.gitignore`**

create-next-app 默认忽略 `.env*`。追加一行 `!.env.example` 使样例可提交。

- [ ] **Step 5: 启动并验证**

```bash
docker compose up -d
sleep 5
docker compose exec db psql -U agilecampus -c '\l' | grep agilecampus_test && echo DB-OK
```

Expected: 输出 `DB-OK`。

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml scripts/init-test-db.sql .env.example .gitignore
git commit -m "chore: Postgres 开发环境与测试库"
```

---

### Task 3: Drizzle Schema（users / teams / team_members）

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`

- [ ] **Step 1: 创建 `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: 创建 `src/db/schema.ts`**

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_team_user_unique").on(t.teamId, t.userId)],
);
```

- [ ] **Step 3: 创建 `src/db/index.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

- [ ] **Step 4: 推送 schema 到开发库与测试库**

```bash
npm run db:push
npm run db:push:test
docker compose exec db psql -U agilecampus -d agilecampus -c '\dt' | grep team_members && echo SCHEMA-OK
```

Expected: 输出 `SCHEMA-OK`，两库均有三张表。

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts src/db
git commit -m "feat: 数据库 schema——users/teams/team_members 与三角色枚举"
```

---

### Task 4: 密码工具（TDD）

**Files:**
- Create: `tests/setup.ts`
- Create: `tests/password.test.ts`
- Create: `src/lib/password.ts`

- [ ] **Step 1: 创建 `tests/setup.ts`**

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
```

- [ ] **Step 2: 写失败测试 `tests/password.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password", () => {
  it("哈希后能用原密码验证通过", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
  });

  it("错误密码验证失败", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("同一密码两次哈希结果不同（随机盐）", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
npm test -- tests/password.test.ts
```

Expected: FAIL（`@/lib/password` 不存在）。

- [ ] **Step 4: 实现 `src/lib/password.ts`**

```ts
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 5: 运行确认通过并提交**

```bash
npm test -- tests/password.test.ts
git add tests/setup.ts tests/password.test.ts src/lib/password.ts
git commit -m "feat: 密码哈希与校验（bcryptjs）"
```

Expected: 3 passed。

---

### Task 5: 注册核心逻辑 createUser（TDD）+ 注册页

**Files:**
- Create: `tests/helpers.ts`
- Create: `tests/user.test.ts`
- Create: `src/lib/errors.ts`
- Create: `src/lib/user.ts`
- Create: `src/app/(auth)/register/actions.ts`
- Create: `src/app/(auth)/register/page.tsx`

- [ ] **Step 1: 创建 `src/lib/errors.ts`**

```ts
// 可预期业务错误：message 可直接展示给用户
export class AppError extends Error {}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行此操作") {
    super(message);
  }
}
```

- [ ] **Step 2: 创建 `tests/helpers.ts`（测试间清库）**

```ts
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function resetDb() {
  await db.execute(sql`TRUNCATE team_members, teams, users RESTART IDENTITY CASCADE`);
}
```

（后续作战图新增表时在此追加表名。）

- [ ] **Step 3: 写失败测试 `tests/user.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { verifyPassword } from "@/lib/password";
import { resetDb } from "./helpers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("createUser", () => {
  beforeEach(resetDb);

  it("创建用户并存哈希而非明文", async () => {
    const user = await createUser({
      email: "zhou@example.com",
      password: "password123",
      name: "周瑜",
    });
    expect(user.email).toBe("zhou@example.com");
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.passwordHash).not.toBe("password123");
    expect(await verifyPassword("password123", row.passwordHash)).toBe(true);
  });

  it("重复邮箱抛出可展示错误", async () => {
    await createUser({ email: "dup@example.com", password: "password123", name: "甲" });
    await expect(
      createUser({ email: "dup@example.com", password: "password123", name: "乙" }),
    ).rejects.toThrow("该邮箱已被注册");
  });
});
```

- [ ] **Step 4: 运行确认失败**

```bash
npm test -- tests/user.test.ts
```

Expected: FAIL（`@/lib/user` 不存在）。

- [ ] **Step 5: 实现 `src/lib/user.ts`**

```ts
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { AppError } from "./errors";

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email));
  if (existing) throw new AppError("该邮箱已被注册");

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, name: input.name })
    .returning({ id: users.id, email: users.email, name: users.name });
  return user;
}
```

- [ ] **Step 6: 运行确认通过**

```bash
npm test -- tests/user.test.ts
```

Expected: 2 passed。

- [ ] **Step 7: 创建 `src/app/(auth)/register/actions.ts`（薄封装，边界校验用 Zod）**

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createUser } from "@/lib/user";
import { AppError } from "@/lib/errors";

const registerSchema = z.object({
  name: z.string().min(1, "请填写姓名"),
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位"),
});

export type FormState = { error: string } | null;

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createUser(parsed.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect("/login?registered=1");
}
```

- [ ] **Step 8: 创建 `src/app/(auth)/register/page.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "./actions";

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    registerAction,
    null,
  );

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">注册 AgileCampus</h1>
      <form action={formAction} className="space-y-3">
        <input name="name" placeholder="姓名" className="w-full rounded border p-2" />
        <input name="email" type="email" placeholder="邮箱" className="w-full rounded border p-2" />
        <input name="password" type="password" placeholder="密码（至少 8 位）" className="w-full rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "注册中…" : "注册"}
        </button>
      </form>
      <p className="text-sm text-gray-500">
        已有账号？<Link href="/login" className="underline">去登录</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 9: 手动验证并提交**

```bash
npm run dev -- --port 3100 &
# 浏览器访问 http://localhost:3100/register，提交表单后应跳转 /login?registered=1
kill %1
git add src/lib/errors.ts src/lib/user.ts "src/app/(auth)/register" tests/helpers.ts tests/user.test.ts
git commit -m "feat: 用户注册（createUser + 注册页）"
```

---

### Task 6: Auth.js 登录与受保护布局

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/types/next-auth.d.ts`
- Create: `src/app/(auth)/login/actions.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(app)/layout.tsx`
- Modify: `src/app/page.tsx`（根路径重定向）

- [ ] **Step 1: 创建 `src/lib/auth.ts`**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, parsed.data.email));
        if (!user) return null;

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
```

- [ ] **Step 2: 创建 `src/types/next-auth.d.ts`（补全 session.user.id 类型）**

```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
    };
  }
}
```

- [ ] **Step 3: 创建 `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: 创建 `src/app/(auth)/login/actions.ts`**

```ts
"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type FormState = { error: string } | null;

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/teams",
    });
    return null;
  } catch (e) {
    if (e instanceof AuthError) return { error: "邮箱或密码不正确" };
    throw e; // signIn 成功时抛出的 redirect 必须继续上抛
  }
}
```

- [ ] **Step 5: 创建 `src/app/(auth)/login/page.tsx`**

```tsx
"use client";

import { Suspense } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction, type FormState } from "./actions";

function LoginForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    loginAction,
    null,
  );
  const registered = useSearchParams().get("registered");

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">登录 AgileCampus</h1>
      {registered && <p className="text-sm text-green-600">注册成功，请登录。</p>}
      <form action={formAction} className="space-y-3">
        <input name="email" type="email" placeholder="邮箱" className="w-full rounded border p-2" />
        <input name="password" type="password" placeholder="密码" className="w-full rounded border p-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
      <p className="text-sm text-gray-500">
        没有账号？<Link href="/register" className="underline">去注册</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

- [ ] **Step 6: 创建受保护布局 `src/app/(app)/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-bold">AgileCampus</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <span className="mr-3 text-sm text-gray-500">{session.user.name}</span>
          <button className="text-sm underline">退出</button>
        </form>
      </header>
      <div className="p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: 修改 `src/app/page.tsx` 为重定向**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/teams" : "/login");
}
```

- [ ] **Step 8: 手动验证并提交**

```bash
npm run dev -- --port 3100 &
# 验证：/ 未登录跳 /login；注册→登录→跳 /teams（暂 404，Task 9 补）；退出后再访问 /teams 跳回 /login
kill %1
git add src/lib/auth.ts src/types src/app
git commit -m "feat: Auth.js 邮箱密码登录与受保护布局"
```

---

### Task 7: 团队创建与邀请码加入（TDD）

**Files:**
- Create: `tests/team.test.ts`
- Create: `src/lib/team.ts`

- [ ] **Step 1: 写失败测试 `tests/team.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { resetDb } from "./helpers";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

describe("createTeam", () => {
  beforeEach(resetDb);

  it("创建团队，创建者成为 admin，且生成邀请码", async () => {
    const u = await makeUser("owner@example.com");
    const team = await createTeam(u.id, "东吴实验室");
    expect(team.name).toBe("东吴实验室");
    expect(team.inviteCode).toHaveLength(10);

    const [m] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, u.id)));
    expect(m.role).toBe("admin");
  });
});

describe("joinTeam", () => {
  beforeEach(resetDb);

  it("凭邀请码加入，默认角色 student", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const joiner = await makeUser("joiner@example.com");

    const joined = await joinTeam(joiner.id, team.inviteCode);
    expect(joined.teamId).toBe(team.id);

    const [m] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, joiner.id)));
    expect(m.role).toBe("student");
  });

  it("邀请码无效时抛出可展示错误", async () => {
    const u = await makeUser("a@example.com");
    await expect(joinTeam(u.id, "no-such-code")).rejects.toThrow("邀请码无效");
  });

  it("重复加入抛出可展示错误", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    await expect(joinTeam(owner.id, team.inviteCode)).rejects.toThrow("已在该团队中");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/team.test.ts
```

Expected: FAIL（`@/lib/team` 不存在）。

- [ ] **Step 3: 实现 `src/lib/team.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { teamMembers, teams, type TeamRole } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";

export async function createTeam(userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ name, inviteCode: nanoid(10) })
      .returning();
    await tx.insert(teamMembers).values({
      teamId: team.id,
      userId,
      role: "admin",
    });
    return team;
  });
}

export async function joinTeam(userId: string, inviteCode: string) {
  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
  if (!team) throw new AppError("邀请码无效");

  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  const [member] = await db
    .insert(teamMembers)
    .values({ teamId: team.id, userId, role: "student" })
    .returning();
  return member;
}
```

（`ForbiddenError` 与 `TeamRole` 供 Task 8 使用；若 lint 报未使用，Task 8 完成后自然消除。）

- [ ] **Step 4: 运行确认通过并提交**

```bash
npm test -- tests/team.test.ts
git add tests/team.test.ts src/lib/team.ts
git commit -m "feat: 团队创建与邀请码加入"
```

Expected: 4 passed。

---

### Task 8: 权限函数 requireTeamRole 与角色管理（TDD）

**Files:**
- Modify: `tests/team.test.ts`（追加两个 describe 块）
- Modify: `src/lib/team.ts`（追加两个函数）

- [ ] **Step 1: 在 `tests/team.test.ts` 顶部 import 处追加，并在文件末尾追加失败测试**

```ts
import { requireTeamRole, updateMemberRole } from "@/lib/team";

describe("requireTeamRole", () => {
  beforeEach(resetDb);

  it("角色在允许列表内则返回成员记录", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const m = await requireTeamRole(owner.id, team.id, ["admin"]);
    expect(m.role).toBe("admin");
  });

  it("非成员抛 ForbiddenError", async () => {
    const owner = await makeUser("owner@example.com");
    const outsider = await makeUser("outsider@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    await expect(requireTeamRole(outsider.id, team.id, ["admin", "teacher", "student"]))
      .rejects.toThrow("没有权限");
  });

  it("角色不足抛 ForbiddenError", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const student = await makeUser("student@example.com");
    await joinTeam(student.id, team.inviteCode);
    await expect(requireTeamRole(student.id, team.id, ["admin"]))
      .rejects.toThrow("没有权限");
  });
});

describe("updateMemberRole", () => {
  beforeEach(resetDb);

  it("admin 可将成员改为 teacher", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const member = await makeUser("t@example.com");
    await joinTeam(member.id, team.inviteCode);

    const updated = await updateMemberRole(owner.id, team.id, member.id, "teacher");
    expect(updated.role).toBe("teacher");
  });

  it("student 无权改角色", async () => {
    const owner = await makeUser("owner@example.com");
    const team = await createTeam(owner.id, "东吴实验室");
    const s1 = await makeUser("s1@example.com");
    const s2 = await makeUser("s2@example.com");
    await joinTeam(s1.id, team.inviteCode);
    await joinTeam(s2.id, team.inviteCode);

    await expect(updateMemberRole(s1.id, team.id, s2.id, "teacher"))
      .rejects.toThrow("没有权限");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npm test -- tests/team.test.ts
```

Expected: 新增用例 FAIL（函数不存在）。

- [ ] **Step 3: 在 `src/lib/team.ts` 追加实现**

```ts
export async function requireTeamRole(
  userId: string,
  teamId: string,
  allowed: TeamRole[],
) {
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  if (!member || !allowed.includes(member.role)) throw new ForbiddenError();
  return member;
}

export async function updateMemberRole(
  actorId: string,
  teamId: string,
  targetUserId: string,
  role: TeamRole,
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const [updated] = await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning();
  if (!updated) throw new AppError("该成员不在团队中");
  return updated;
}
```

- [ ] **Step 4: 运行全部测试并提交**

```bash
npm test
git add tests/team.test.ts src/lib/team.ts
git commit -m "feat: requireTeamRole 权限函数与成员角色管理"
```

Expected: 全部 passed。

---

### Task 9: 团队页面（列表 / 创建 / 加入）

**Files:**
- Create: `src/app/(app)/teams/actions.ts`
- Create: `src/app/(app)/teams/page.tsx`
- Create: `src/app/(app)/teams/team-forms.tsx`

- [ ] **Step 1: 创建 `src/app/(app)/teams/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createTeam, joinTeam } from "@/lib/team";
import { AppError } from "@/lib/errors";

export type FormState = { error: string } | null;

export async function createTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = z.string().min(1, "请填写团队名称").safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await createTeam(session.user.id, parsed.data);
  revalidatePath("/teams");
  return null;
}

export async function joinTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = z.string().min(1, "请填写邀请码").safeParse(formData.get("inviteCode"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await joinTeam(session.user.id, parsed.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/teams");
  return null;
}
```

- [ ] **Step 2: 创建 `src/app/(app)/teams/page.tsx`**

```tsx
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teamMembers, teams } from "@/db/schema";
import { TeamForms } from "./team-forms";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const myTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      inviteCode: teams.inviteCode,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, session.user.id));

  return (
    <main className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">我的团队</h1>
      <ul className="space-y-2">
        {myTeams.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded border p-3">
            <div>
              <span className="font-medium">{t.name}</span>
              <span className="ml-2 text-xs text-gray-500">角色：{t.role}</span>
              <span className="ml-2 text-xs text-gray-400">邀请码：{t.inviteCode}</span>
            </div>
            <Link href={`/teams/${t.id}/members`} className="text-sm underline">
              成员管理
            </Link>
          </li>
        ))}
        {myTeams.length === 0 && (
          <li className="text-sm text-gray-500">尚未加入任何团队，创建一个或凭邀请码加入。</li>
        )}
      </ul>
      <TeamForms />
    </main>
  );
}
```

- [ ] **Step 3: 创建 `src/app/(app)/teams/team-forms.tsx`（客户端表单组件）**

```tsx
"use client";

import { useActionState } from "react";
import { createTeamAction, joinTeamAction, type FormState } from "./actions";

export function TeamForms() {
  const [createState, createFormAction, creating] = useActionState<FormState, FormData>(
    createTeamAction,
    null,
  );
  const [joinState, joinFormAction, joining] = useActionState<FormState, FormData>(
    joinTeamAction,
    null,
  );

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <form action={createFormAction} className="space-y-2 rounded border p-4">
        <h2 className="font-medium">创建团队</h2>
        <input name="name" placeholder="团队名称" className="w-full rounded border p-2" />
        {createState?.error && <p className="text-sm text-red-600">{createState.error}</p>}
        <button disabled={creating} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
          创建
        </button>
      </form>
      <form action={joinFormAction} className="space-y-2 rounded border p-4">
        <h2 className="font-medium">加入团队</h2>
        <input name="inviteCode" placeholder="邀请码" className="w-full rounded border p-2" />
        {joinState?.error && <p className="text-sm text-red-600">{joinState.error}</p>}
        <button disabled={joining} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
          加入
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: 手动验证并提交**

```bash
npm run dev -- --port 3100 &
# 验证：登录后 /teams 可创建团队（显示邀请码、角色 admin）；另一账号凭邀请码加入（角色 student）
kill %1
git add src/app
git commit -m "feat: 团队列表、创建与邀请码加入页面"
```

---

### Task 10: 成员管理页（admin 改角色）

**Files:**
- Create: `src/app/(app)/teams/[teamId]/members/actions.ts`
- Create: `src/app/(app)/teams/[teamId]/members/page.tsx`

- [ ] **Step 1: 创建 `actions.ts`**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";

const schema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["admin", "teacher", "student"]),
});

export async function updateRoleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = schema.parse(Object.fromEntries(formData));
  await updateMemberRole(session.user.id, parsed.teamId, parsed.userId, parsed.role);
  revalidatePath(`/teams/${parsed.teamId}/members`);
}
```

- [ ] **Step 2: 创建 `page.tsx`**

```tsx
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teamMembers, teams, users } from "@/db/schema";
import { updateRoleAction } from "./actions";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 访问者必须是团队成员
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, session.user.id)));
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  const isAdmin = me.role === "admin";

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{team.name} · 成员</h1>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between rounded border p-3">
            <span>
              {m.name} <span className="text-xs text-gray-500">{m.email}</span>
            </span>
            {isAdmin && m.userId !== session.user.id ? (
              <form action={updateRoleAction} className="flex items-center gap-2">
                <input type="hidden" name="teamId" value={teamId} />
                <input type="hidden" name="userId" value={m.userId} />
                <select name="role" defaultValue={m.role} className="rounded border p-1 text-sm">
                  <option value="admin">admin</option>
                  <option value="teacher">teacher</option>
                  <option value="student">student</option>
                </select>
                <button className="rounded bg-black px-2 py-1 text-xs text-white">保存</button>
              </form>
            ) : (
              <span className="text-sm text-gray-500">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: 手动验证并提交**

```bash
npm run dev -- --port 3100 &
# 验证：admin 可改他人角色并即时生效；student 登录看同页只读；非成员访问该页 404
kill %1
git add src/app
git commit -m "feat: 团队成员管理页（admin 调整角色）"
```

---

### Task 11: 收尾——全量测试、构建、README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 全量回归**

```bash
npm test && npm run lint && npm run build
```

Expected: 测试全绿、lint 无 error、build 成功。任何失败先修再进。

- [ ] **Step 2: 创建 `README.md`**

```markdown
# AgileCampus

面向高校团队的 Agent 驱动轻量项目管理平台（MVP 开发中）。

## 本地启动

    docker compose up -d          # 启动 Postgres（自动建 dev 与 test 两库）
    cp .env.example .env          # 填入 AUTH_SECRET（openssl rand -base64 32）
    npm install
    npm run db:push               # 推送 schema 到开发库
    npm run db:push:test          # 推送 schema 到测试库
    npm run dev

## 测试

    npm test

## 文档

- 设计：docs/superpowers/specs/2026-07-02-agilecampus-mvp-design.md
- 作战图一（地基）：docs/superpowers/plans/2026-07-02-agilecampus-plan1-foundation.md
```

- [ ] **Step 3: 对照验收标准（设计文档第 8 节第 1、4 条）逐项手测**

清单：
1. 注册 → 登录 → 退出 → 重登录，全程无错。
2. 创建团队，创建者角色为 admin，邀请码可见。
3. 第二账号凭邀请码加入，角色 student；重复加入报"已在该团队中"。
4. admin 在成员页改角色即时生效；student 看到只读列表。
5. 非团队成员访问 `/teams/<别队id>/members` 得 404。
6. 错误路径（重复邮箱、错密码、无效邀请码）均有明确提示，无静默失败。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README 与地基阶段收尾"
```

---

## 后续作战图（本图不含）

- **作战图二：骨架**——projects / milestones / tasks 表与页面、看板三列拖拽、任务 CRUD（依赖本图的 requireTeamRole）
- **作战图三：灵魂**——conversations / messages 表、Vercel AI SDK + DeepSeek 接入、六工具、写操作确认卡片、LLM 回放集成测试
