# AgileCampus 全功能整合原型与合并方案

> 生成模型：Step-5-Preview（WorkBuddy）　日期：2026-11-19
> 分支：`terry/merged-prototype`（基于 `terry/ai-dashboard-acceptance`）
> 本分支为**新增分支**，未改动任何已有分支或文件。

## 一、这份原型是什么

`index.html` 是一个**可交互的产品原型**：打开后点左侧图标栏，可以在同一个产品里看到两条线所有的功能。每个模块右上角都标了来源：

| 角标 | 含义 | 功能 |
|---|---|---|
| 蓝色 `terry 线` | 来自 `功能/ai-home-dashboard` | 看板、私聊/群聊、云文档、AI 日报、日历、任务进度 |
| 紫色 `student 线` | 来自 `student/y123456-wq-workspace` | AI 助手、时间线甘特、三级角色、飞书、Agent Token、资源占用 |
| 青色 `◆ 整合视图` | 本次新设计的合并点 | 今日总览（跨项目）、集成设置（两套认证合一） |

**它不是可上线的代码**，是"整合后长什么样"的演示，用来给团队对齐目标形态。

## 二、为什么不能直接把两个分支合并

两条线不是同一套代码的两个版本，而是**两套独立产品**：

| 维度 | terry 线 | student 线 |
|---|---|---|
| 源码目录 | `app/` | `src/app/` |
| 认证 | 自研 scrypt + sessions 表 + httpOnly Cookie | Auth.js v5 (JWT) + 飞书 OAuth |
| 数据库表 | 34 张（dm_*/docs_*/chat_* 等） | 另一套（apiTokens/conversations/resourceUsages 等） |
| 角色 | `users.role`: owner/admin/member | `teamRoleEnum`: admin/teacher/student |
| ORM/测试 | Drizzle + node:test | Drizzle + Vitest |

表名重叠但字段不同、认证体系互斥、目录结构不同——`git merge` 只会产生海量冲突，即使强行合也跑不起来。所以整合是**架构迁移**，不是版本合并。

## 三、真正合并的推荐路线（以 terry 线为主干）

terry 线是服务器实际部署的版本、功能覆盖最广，建议以它为主干，把 student 线的差异化能力逐个移植。按顺序做，每步单独一个分支：

1. **数据层并表**：给 terry 线 `db/schema.ts` 增加 student 线独有的表 —— `apiTokens`、`resourceUsages`、`conversations`/`messages`（AI 对话）、`taskDependencies`、`projectDocuments`；角色字段扩展为 `owner/admin/teacher/student`。写幂等迁移脚本 `db:add-integration-tables`。
2. **认证统一**（最关键）：保留 terry 线自研会话为唯一会话源；飞书 OAuth 作为**并列登录入口**，回调成功后同样签发 `agile_session` Cookie，绝不让两套 session 并存。改动集中在 `app/api/auth/` 与 `lib/auth.ts`。
3. **三级角色**：把 `users.role` 扩展后，补权限中间件（教师跨组只读、学生仅写本人项目），与团队内"负责人/组员"分工标签叠加而非替换。
4. **移植独立模块**（彼此无依赖，可并行）：
   - 时间线甘特：`src/app/(app)/projects/[id]/timeline` → `app/projects/[id]/timeline`
   - AI 助手：`src/lib/agent/*` + `api/chat/*`，确认模型后端（DeepSeek key）后再接
   - Agent 写入 API：`api/agent/*` + `src/lib/api-token.ts`，挂 terry 线的 `requireUser`
   - 资源占用：`resourceUsages` 表 + 登记页 + 汇总
5. **验收**：每步跑 `npm run lint && npm run build && npm test`；DB 集成测试需真实 PostgreSQL（12 个用例在无库环境必失败，属预期）。
6. **收尾**：需求文档里"已实现"清单按最终主干更新；确认不再维护 student 线，标记 deprecated。

## 四、工作量与风险提示

- 这是**数天级**的迁移，不是一次合并提交能完成；建议按上面 6 步拆成 6 个 PR。
- 风险最高的是认证统一（第 2 步）——做错会导致全员掉登录。务必先在一套测试库上跑通 OAuth 回调再上生产。
- AI 助手依赖外部模型密钥，没有 key 时只能保留 UI 与草案逻辑，不能真正落库调用。
- 两个分支的测试框架不同（node:test vs Vitest），移植模块时测试要改写而非照搬。

## 五、演示方式

直接用浏览器打开 `index.html`（无需服务器、无外部依赖），点左侧导航切换 9 个功能视图。原型里的交互是演示性的（切换开关、勾选草案、发消息会弹提示），不连接真实数据库。
