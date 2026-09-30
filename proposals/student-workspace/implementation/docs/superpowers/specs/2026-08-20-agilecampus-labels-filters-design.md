# AgileCampus 一期 · 标签与视图（Labels / Filters / Grouping）设计

日期：2026-08-20
参照：makeplane/plane 的 labels + filter/group-by 体验

## 1. 背景与目标

本营已有团队、项目、里程碑、任务（含子任务与依赖）、拖拽看板、甘特、AI 助手、资源登记、Agent 写入 API。
对照 plane，缺的不是「有没有项目管理」，而是**日常操作的信息密度**：任务无法分类，看板无法筛选，列固定按状态三分。

本期目标：

1. 引入**团队级共享标签**，任务可多标签
2. 项目页新增**筛选栏**（指派人 / 优先级 / 标签 / 里程碑 / 逾期），筛选态写入 URL
3. 看板列可按 **状态 · 指派人 · 优先级 · 里程碑** 切换分组，且各分组下拖拽均生效

后续分期（本文档不含）：二期协作留痕（评论 + 活动流 + 站内通知），三期迭代节奏（Cycles + 燃尽图 + 我的工作台）。

## 2. 范围边界

**本期做：**

- `labels` / `task_labels` 两张表
- `src/lib/label.ts` 服务层
- `/teams/[teamId]/labels` 标签管理页
- 项目页筛选栏组件 + Board 分组改造
- `moveTaskAction` 泛化为字段白名单
- `tests/label.test.ts` 服务层测试

**本期明确不做**（守手术式修改之戒，勿顺手扩张）：

- Agent 写工具与 AI 助手的标签能力（`src/lib/agent/tools.ts` 不动）
- `/projects` 跨项目总览的标签筛选
- 甘特 / 时间线视图的标签与筛选
- 表格（Spreadsheet）布局
- 自定义状态、估点

## 3. 数据模型

追加至 `src/db/schema.ts`：

```ts
export const labelColorEnum = pgEnum("label_color", [
  "slate", "red", "amber", "green", "blue", "violet", "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);
```

**决策记录：**

- **团队级而非项目级**：实验室内项目多且同质（"论文""实验""代码""数据清洗"），共享免去每建一项目重建一套标签之苦；亦为日后 `/projects` 总览按标签筛选留门。
- **颜色存色板键而非 hex**：UI 配色可控，且杜绝任意字符串进入 style 造成样式注入。色板键到 Tailwind class 的映射集中在一处常量表。
- **名称写入前统一 `trim()`**；唯一索引建在 `(teamId, name)` 普通两列，大小写不敏感去重由服务层 `lower()` 查询承担——避开 drizzle-kit push 对表达式索引 diff 的不稳。

## 4. 服务层 `src/lib/label.ts`

沿既有军规：入口自校验身份与权限、错误以 `AppError` 转译、跨团队访问一律 `ForbiddenError`。

| 函数 | 权限 | 说明 |
|---|---|---|
| `listTeamLabels(actorId, teamId)` | 团队成员（含 teacher） | 按 name 排序返回 |
| `createLabel(actorId, teamId, {name, color})` | 仅 admin | name 先 `trim()`，空则 `AppError("标签名不可为空")`；长度上限 20；重名 `AppError("标签已存在")` |
| `renameLabel(actorId, labelId, {name?, color?})` | 仅 admin | 同上校验 |
| `deleteLabel(actorId, labelId)` | 仅 admin | 关联行由 `task_labels` 的 cascade 自动清除 |
| `setTaskLabels(actorId, taskId, labelIds[])` | `TASK_WRITE_ROLES`（admin + student） | 全量替换，同构于既有 `setTaskSuccessors` |

`setTaskLabels` 校验链：

1. 任务须存在 → 否则 `AppError("任务不存在")`
2. `requireTaskWrite(actorId, task.projectId)`（复用 `src/lib/task.ts` 既有守卫，需从该模块导出）
3. 所有 `labelIds` 须属于该任务所在项目之团队 → 否则 `AppError("标签不属于该团队")`——杜绝跨团队挂载
4. 事务内先 `delete where taskId` 再批量 `insert`

**权限口径说明**：标签**定义**属团队配置，仅 admin 可增删改（同 milestone 口径）；标签**贴附**属日常任务写操作，admin + student 皆可，teacher 只读。

## 5. 读取层改造

`listProjectTasks(actorId, projectId)` 追加 `labels: { id, name, color }[]` 字段。

实现方式：**第二次查询后在 JS 侧归并**，不用 `leftJoin`。

```ts
const rows = await db.select({...}).from(tasks).leftJoin(users, ...)...;
const labelRows = await db
  .select({ taskId: taskLabels.taskId, id: labels.id, name: labels.name, color: labels.color })
  .from(taskLabels)
  .innerJoin(labels, eq(taskLabels.labelId, labels.id))
  .innerJoin(tasks, eq(taskLabels.taskId, tasks.id))
  .where(eq(tasks.projectId, projectId));
// 按 taskId 分组塞回
```

理由：`leftJoin` 会造成行乘积，污染既有 `orderBy(tasks.sortOrder)` 与调用方对「一行一任务」的假设；`json_agg` 则牺牲可读性与可测性。两次查询在千级任务量下无性能之虞。

`getTaskDetail` 同样追加 labels（供任务详情弹窗回显选中态）。

## 6. 界面

### 6.1 标签管理页 `/teams/[teamId]/labels`

与 `members` / `resources` 并列的团队子页。列出标签（色点 + 名称 + 使用计数），admin 可新增 / 改名换色 / 删除；非 admin 仅见列表。
Server Component 取数 + 同目录 `actions.ts` 内 Server Action 写入，同既有页面形制。

### 6.2 筛选栏 `filter-bar.tsx`（Client Component）

置于看板之上。控件：

- 指派人（下拉多选）
- 优先级（低/中/高，多选）
- 标签（多选）
- 里程碑（多选，含「无里程碑」）
- 逾期（开关：仅看 `dueDate < today && status !== 'done'`）
- 分组依据（单选：状态 / 指派人 / 优先级 / 里程碑）

状态以 query string 表达，形如
`?assignee=<uuid>,<uuid>&priority=high&label=<uuid>&overdue=1&group=assignee`，
经 `router.replace(url, { scroll: false })` 写入，故可分享、可刷新保持、可后退。
解析与序列化集中于 `src/lib/board-filters.ts` 一个纯函数模块（`parseFilters(searchParams)` / `serializeFilters(f)`），便于单测。

筛选在客户端对已注入的任务数组执行——任务全量已由 Server Component 传下，无需再往返。

### 6.3 Board 改造

- `COLUMNS` 常量 → `deriveColumns(groupBy, { members, milestones })` 纯函数，返回 `{ key, label, matches(task), patch }[]`
  - `status` 分组：三列（待办/进行中/已完成），`patch = { status: key }`
  - `assignee` 分组：每成员一列 + 「未指派」列，`patch = { assigneeId: key === "none" ? null : key }`
  - `priority` 分组：三列，`patch = { priority: key }`
  - `milestone` 分组：每里程碑一列 + 「无里程碑」列，`patch = { milestoneId: key === "none" ? null : key }`
- `handleDragEnd` 据当前列的 `patch` 调 `moveTaskAction`
- 乐观更新 `useOptimistic` 的 reducer 由「改 status」改为「合并 patch」
- 列数不定，栅格由 `grid-cols-3` 改为横向滚动的 flex 容器（成员多时不致挤压）

### 6.4 任务卡与编辑弹窗

`task-card.tsx` 卡面显示标签胶囊（至多 3 枚 + 「+N」）；编辑弹窗内新增标签多选，随任务保存一并提交。

## 7. Server Action 改造

`moveTaskAction` 由「只接受 status」泛化为字段白名单：

```ts
const movePatchSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  milestoneId: z.uuid().nullable().optional(),
});
```

仅这四字段可经拖拽改动；校验与授权仍全数落在既有 `updateTask`（含指派人属团队、里程碑属项目之校验），故越权无隙可乘。
标签不另设 action，随 `updateTaskAction` 的 `labelIds` 字段一并提交，同构于既有 `successorIds` 之形制。

## 8. 测试

`tests/label.test.ts`（Vitest，沿既有测试形制）：

1. admin 建标签成功；student 建标签被拒（`ForbiddenError`）
2. 同团队重名（大小写不同）被拒
3. 空名 / 超长名被拒
4. 团队成员（含 teacher）可读标签列表
5. student 可 `setTaskLabels`；teacher 不可
6. 跨团队标签挂载被拒
7. 删标签后，原贴该标签之任务读取时标签消失（cascade 生效）

`tests/board-filters.test.ts`：`parseFilters` / `serializeFilters` 往返一致性、非法参数被忽略而非抛错。

## 9. 验收标准

1. `npm test` 全绿，新增测试覆盖上述用例
2. `npm run lint` 与 `npm run build` 无错
3. admin 可在 `/teams/[teamId]/labels` 增删改标签，非 admin 只读
4. 项目页可按五个维度筛选，筛选态刷新后保持，URL 可分享
5. 看板分组可在四个维度间切换，任一分组下拖拽卡片皆能落库并即时反映
6. teacher 账号在项目页无任何写入入口，拖拽被服务端拒绝
7. 既有功能（甘特、AI 助手、Agent API、飞书通知）行为不变
