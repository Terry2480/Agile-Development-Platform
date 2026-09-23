# 飞书展示卡片 实施计划（Plan B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三类飞书通知（指派/完成/日报）从纯文本升级为展示型 interactive 卡片，卡片「查看详情」深链到项目页并自动打开对应任务弹窗。

**Architecture:** `feishu.ts` 加 `sendCardMessage`；卡片模板抽到 `feishu-card.ts`；`notify.ts` 三函数补查项目名/负责人名后改调卡片；项目页 `TaskCard` 读 `?task=` 自动打开编辑弹窗，闭合「卡片→网页」深链。

**Tech Stack:** Next.js 16 (App Router) · Drizzle ORM + PostgreSQL · 飞书 im/v1 interactive 卡片 · Vitest

**依赖：** Plan A（飞书登录）不是硬前置，但深链在飞书内打开需 Plan A 的 JSSDK 免登方臻完美体验；可先于 Plan A 独立实现与单测。

---

## 前置说明（executor 必读）

- 测试：`npm test`。单文件：`npm test -- tests/xxx.test.ts`。
- 现有 `feishu.ts`：`getTenantAccessToken`/`sendTextMessage`（保留）+ 内部 `BASE()`。
- 现有 `notify.ts`：`notifyTaskAssigned(task)`/`notifyTaskCompleted(task,actorId)`/`scanAndNotifyDue()`，`TaskRow = {id,title,dueDate,assigneeId,createdById?}`，内部 `openIdOf`/`safeSend`。
- `notify` 收的 task 来自 `createTask`/`updateTask` 返回 row（drizzle `returning()`），**含 `projectId`/`priority`**（schema `tasks` 有此二列）。
- 现有多处测试 `vi.mock("@/lib/feishu", () => ({ sendTextMessage: ... }))`——本 plan 改 notify 用 `sendCardMessage`，须同步更新这些 mock。
- `env`：卡片深链用 `AGILECAMPUS_URL`。
- `AGENTS.md`：改 Next 相关代码前查 `node_modules/next/dist/docs/`。
- **飞书卡片 JSON schema**（header/elements/div-fields/action-button）实现前以飞书开放平台官方文档核验，仅调字段名、不改函数签名与结构。

---

## Task 1: sendCardMessage + 卡片模板

**Files:**
- Modify: `src/lib/feishu.ts`（`sendCardMessage`）
- Create: `src/lib/feishu-card.ts`
- Test: `tests/feishu.test.ts`（追加 sendCardMessage）、`tests/feishu-card.test.ts`（新建）

- [x] **Step 1: 写 sendCardMessage 失败测试**

在 `tests/feishu.test.ts` 末尾追加：

```ts
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
    expect(typeof body.content).toBe("string"); // content 为 JSON 字符串
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
```

- [x] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/feishu.test.ts`
Expected: FAIL（`sendCardMessage` 未导出）。

- [x] **Step 3: 实现 sendCardMessage**

在 `src/lib/feishu.ts` 末尾追加：

```ts
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
```

- [x] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/feishu.test.ts`
Expected: PASS（含既有 sendTextMessage 用例）。

- [x] **Step 5: 写卡片模板失败测试**

Create `tests/feishu-card.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAssignedCard, buildCompletedCard, buildDueReminderCard } from "@/lib/feishu-card";

beforeEach(() => vi.stubEnv("AGILECAMPUS_URL", "https://ac.test"));
afterEach(() => vi.unstubAllEnvs());

const task = {
  id: "t1", title: "斥候", projectId: "p1", projectName: "赤壁",
  assigneeName: "主帅", dueDate: "2026-08-01", priority: "high",
};

describe("buildAssignedCard", () => {
  it("含标题/项目/负责人 + 深链按钮", () => {
    const card = buildAssignedCard(task);
    const json = JSON.stringify(card);
    expect(json).toContain("斥候");
    expect(json).toContain("赤壁");
    expect(json).toContain("主帅");
    expect(json).toContain("https://ac.test/projects/p1?task=t1");
  });
});

describe("buildCompletedCard", () => {
  it("含完成情况 + 深链", () => {
    const card = buildCompletedCard({ ...task, completionNote: "克城" });
    const json = JSON.stringify(card);
    expect(json).toContain("克城");
    expect(json).toContain("https://ac.test/projects/p1?task=t1");
  });
});

describe("buildDueReminderCard", () => {
  it("逾期/临期分栏 + 每任务内联深链", () => {
    const card = buildDueReminderCard({
      overdue: [{ id: "a", title: "逾期活", projectId: "p1" }],
      dueSoon: [{ id: "b", title: "临期活", projectId: "p2" }],
    });
    const json = JSON.stringify(card);
    expect(json).toContain("逾期活");
    expect(json).toContain("临期活");
    expect(json).toContain("https://ac.test/projects/p1?task=a");
    expect(json).toContain("https://ac.test/projects/p2?task=b");
  });
});
```

- [x] **Step 6: 跑测试验证失败**

Run: `npm test -- tests/feishu-card.test.ts`
Expected: FAIL（`@/lib/feishu-card` 不存在）。

- [x] **Step 7: 实现 feishu-card.ts**

Create `src/lib/feishu-card.ts`:

```ts
// 飞书 interactive 卡片模板。卡片 JSON schema 以飞书官方文档核验字段名。
const SITE = () => process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 深链：飞书内点击 → JSSDK 免登 → 项目页 ?task= 自动打开任务弹窗
function taskUrl(projectId: string, taskId: string): string {
  return `${SITE()}/projects/${projectId}?task=${taskId}`;
}

export type CardTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  completionNote?: string | null;
};

function field(content: string, isShort = true) {
  return { is_short: isShort, text: { tag: "lark_md", content } };
}

function detailButton(projectId: string, taskId: string, label = "查看详情") {
  return {
    tag: "action",
    actions: [
      { tag: "button", text: { tag: "plain_text", content: label }, url: taskUrl(projectId, taskId), type: "primary" },
    ],
  };
}

export function buildAssignedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: "🎯 新任务指派" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**负责人**\n${t.assigneeName ?? "未分配"}`),
        field(`**截止**\n${t.dueDate ?? "未设"}`),
        field(`**优先级**\n${t.priority}`),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

export function buildCompletedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "green", title: { tag: "plain_text", content: "✅ 任务完成" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**完成情况**\n${t.completionNote ?? "—"}`, false),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

export type ReminderItem = { id: string; title: string; projectId: string };

export function buildDueReminderCard(input: { overdue: ReminderItem[]; dueSoon: ReminderItem[] }) {
  const line = (i: ReminderItem) => `- [${i.title}](${taskUrl(i.projectId, i.id)})`;
  const elements: unknown[] = [];
  if (input.overdue.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**逾期未完成**\n${input.overdue.map(line).join("\n")}` } });
  }
  if (input.dueSoon.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**即将到期**\n${input.dueSoon.map(line).join("\n")}` } });
  }
  return {
    config: { wide_screen_mode: true },
    header: { template: "orange", title: { tag: "plain_text", content: "⏰ 任务提醒" } },
    elements,
  };
}
```

- [x] **Step 8: 跑测试验证通过**

Run: `npm test -- tests/feishu-card.test.ts`
Expected: PASS（三用例）。

- [x] **Step 9: 提交**

```bash
git add src/lib/feishu.ts src/lib/feishu-card.ts tests/feishu.test.ts tests/feishu-card.test.ts
git commit -m "feat: sendCardMessage + 三类飞书卡片模板(含深链)"
```

---

## Task 2: notify 三函数卡片化 + 补查字段

**Files:**
- Modify: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`（改 mock 与断言）、`tests/task-notify.test.ts` / `tests/cron-reminders.test.ts`（mock 更新）

- [x] **Step 1: 更新 notify.test.ts —— mock sendCardMessage + 断言卡片**

将 `tests/notify.test.ts` 顶部的 feishu mock 改为暴露 `sendCardMessage`：

```ts
// 旧：vi.mock("@/lib/feishu", () => ({ sendTextMessage: (...a) => sendMock(...a) }));
const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/feishu", () => ({ sendCardMessage: (...a: unknown[]) => sendMock(...a) }));
```

各用例中「文案 `toContain("斥候")`」类断言，改为对卡片对象序列化断言。例如 `notifyTaskAssigned` 正例：

```ts
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("ou_owner");
    expect(JSON.stringify(sendMock.mock.calls[0][1])).toContain("斥候"); // 卡片含任务标题
```

`scanAndNotifyDue` 聚合用例同理，断言 `JSON.stringify(card)` 含「临期活」「逾期活」、不含「已完成」。其余（未绑跳过、创建者=操作者不发、fire-and-forget 不抛）断言逻辑不变，仅 mock 名从 sendText 改 sendCard。

- [x] **Step 2: 跑测试验证失败**

Run: `npm test -- tests/notify.test.ts`
Expected: FAIL（notify 仍调 sendTextMessage，sendCardMessage mock 未被调用 → `toHaveBeenCalled` 失败）。

- [x] **Step 3: 改 notify.ts —— 补查字段 + 改调卡片**

将 `src/lib/notify.ts` 全文替换为：

```ts
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users, projects } from "@/db/schema";
import { sendCardMessage } from "./feishu";
import {
  buildAssignedCard,
  buildCompletedCard,
  buildDueReminderCard,
  type CardTask,
  type ReminderItem,
} from "./feishu-card";

// notify 收的 task 来自 createTask/updateTask 返回 row，含 projectId/priority
type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeId: string | null;
  projectId: string;
  priority: string;
  completionNote?: string | null;
  createdById?: string | null;
};

async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 补查卡片所需的 项目名 / 负责人名
async function enrich(task: TaskRow): Promise<CardTask> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId));
  let assigneeName: string | null = null;
  if (task.assigneeId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, task.assigneeId));
    assigneeName = u?.name ?? null;
  }
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: proj?.name ?? "（未知项目）",
    assigneeName,
    dueDate: task.dueDate,
    priority: task.priority,
    completionNote: task.completionNote ?? null,
  };
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget）
async function safeSend(openId: string, card: unknown): Promise<boolean> {
  try {
    await sendCardMessage(openId, card);
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
  await safeSend(openId, buildAssignedCard(await enrich(task)));
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildCompletedCard(await enrich(task)));
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为一封卡片日报。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      openId: users.feishuOpenId,
    })
    .from(tasks)
    .innerJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        isNotNull(users.feishuOpenId),
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

  const byUser = new Map<string, { openId: string; overdue: ReminderItem[]; dueSoon: ReminderItem[] }>();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    if (!r.assigneeId || !r.openId) continue;
    const bucket = byUser.get(r.assigneeId) ?? { openId: r.openId, overdue: [], dueSoon: [] };
    const item: ReminderItem = { id: r.id, title: r.title, projectId: r.projectId };
    if (r.dueDate && r.dueDate < todayStr) bucket.overdue.push(item);
    else bucket.dueSoon.push(item);
    byUser.set(r.assigneeId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const ok = await safeSend(openId, buildDueReminderCard({ overdue, dueSoon }));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
```

- [x] **Step 4: 跑测试验证通过**

Run: `npm test -- tests/notify.test.ts`
Expected: PASS。

- [x] **Step 5: 更新其余 mock feishu 的测试**

`tests/task-notify.test.ts`、`tests/cron-reminders.test.ts` 顶部的 `vi.mock("@/lib/feishu", () => ({ sendTextMessage: ... }))` 改为 `({ sendCardMessage: (...a) => sendMock(...a) })`（断言「被调/收件人」逻辑不变，卡片文案断言用 `JSON.stringify`）。检查 `tests/agent-commit.test.ts` 是否 mock feishu——若无则不动。

Run: `npm test`
Expected: 全绿。说明：notify 现查 `projects` 表——本仓测试建 task 必经 createProject（task.projectId 恒有对应 project），enrich 查得到；未绑飞书者在 openIdOf 即 return，不触发 enrich。

- [x] **Step 6: 提交**

```bash
git add src/lib/notify.ts tests/notify.test.ts tests/task-notify.test.ts tests/cron-reminders.test.ts
git commit -m "feat: notify 三通知卡片化(补查项目名/负责人名)"
```

---

## Task 3: 项目页 ?task= 深链打开任务弹窗

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/task-card.tsx`

> 说明：深链为纯前端交互，`TaskCard` 挂载时读 `?task=` 与自身 id 匹配即打开 `EditModal`。仅 `canWrite`（有 EditModal）时打开；只读者深链不打开弹窗（简化备案，MVP 可接受）。前端交互离线难以单测，落代码 + 手动验收。

- [x] **Step 1: TaskCard 读 ?task= 自动开弹窗**

`src/app/(app)/projects/[projectId]/task-card.tsx` 顶部 import 已有 `useEffect`/`useState`（第 3 行 `import { useActionState, useEffect, useState } from "react";`）；补 `import { useSearchParams } from "next/navigation";`。

在 `TaskCard` 函数体内 `const [editing, setEditing] = useState(false);`（现第 39 行）之后追加：

```tsx
  const searchParams = useSearchParams();
  useEffect(() => {
    // 深链 /projects/[id]?task=<taskId>：命中本卡片则打开详情弹窗（仅 canWrite 有 EditModal）
    if (canWrite && searchParams.get("task") === task.id) setEditing(true);
  }, [searchParams, task.id, canWrite]);
```

- [x] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误。

- [x] **Step 3: 手动验收**

`npm run dev`，登录后访问 `/projects/<项目id>?task=<该项目某任务id>` → 页面加载后应自动弹出该任务的编辑弹窗。无 `?task=` 时行为不变。

- [x] **Step 4: 提交**

```bash
git add "src/app/(app)/projects/[projectId]/task-card.tsx"
git commit -m "feat: ?task= 深链自动打开任务弹窗(闭合卡片→网页)"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4.1 sendCardMessage→Task1；§4.2 卡片模板→Task1；§4.3 深链闭环→Task1(拼装)+Task3(打开)；§4.4 数据充实→Task2(enrich)；§4.5 文件全覆盖。
- **类型一致**：`sendCardMessage(openId,card)`、`CardTask`、`ReminderItem`、`buildAssignedCard/buildCompletedCard/buildDueReminderCard`、`enrich(task):CardTask`、`TaskRow`(含 projectId/priority) —— 各 task 前后一致；notify 收的 row 由 task.ts 的 createTask/updateTask returning 提供（含 projectId/priority）。
- **回归面**：notify 改用 sendCardMessage，所有 mock feishu 的测试须同步（Task2 Step1/Step5 已列 notify/task-notify/cron-reminders）。
- **Placeholder**：卡片 schema 给完整 JSON 构造 + 核验关口（前置说明），非占位。
- **深链只读降级**：非 canWrite 深链不开弹窗，已记简化备案（spec §7）。
