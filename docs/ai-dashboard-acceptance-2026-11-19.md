# AgileCampus 新功能验收与问题修复报告

- 分支：`terry/ai-dashboard-acceptance`（基于 `功能/ai-home-dashboard`，其上游为 v6.2）
- 日期：2026-11-19
- 生成：Step-5-Preview 模型（WorkBuddy）
- 依据：《这里是名字队.pdf》11/18→11/24 计划 + main 分支 docker/部署文档（项目功能与边界）

## 一、需求对照

`功能/ai-home-dashboard` 分支（提交 `39b8f0a`）已实现 PDF 计划中的首页相关项，本分支在此基础上验收并修复：

| PDF 计划项 | 实现位置 | 状态 |
| --- | --- | --- |
| 4.1 首页实时汇总任务待办 + 当前进度 + 截止日期 | `components/ws/TodayPanel.tsx`（任务进度条 + 截止临近/进行中卡片） | ✅ 已实现 |
| 4.2 AI 日报 | `lib/home-report.ts`（本地规则引擎）、`app/api/home/daily-report/route.ts`、`components/ws/DailyReportCard.tsx` | ✅ 已实现，30 秒轮询 |
| 日历（计划项） | `lib/calendar-events.ts`、`app/api/home/calendar/route.ts`、`components/ws/HomeCalendar.tsx` | ✅ 已实现，月历 + 截止/里程碑事件 |

> 说明：PDF 中的「文档系统验收、私聊合并、拖拽、插件功能」属其他工作包，不在本次首页三项范围内。

## 二、验收方法

在独立克隆中执行：`npm run lint`、`npm test`、`npm run build`、新增功能专项测试，并对代码做静态走查（时区口径、日期边界、删除文件引用、鉴权挂载）。

## 三、验收结果

| 项目 | 基线（功能分支） | 本分支修复后 |
| --- | --- | --- |
| `npm run lint` | ❌ 2 error + 2 warning | ✅ 0 problem |
| `npm run build` | ✅ 通过 | ✅ 通过 |
| `npm test`（全量 72） | 60 pass / 12 fail | 60 pass / 12 fail（无新增回归） |
| 新增功能专项（13） | 全部通过 | 13 pass / 0 fail |

### 关于 12 个失败用例

全部为数据库集成测试（`deadline reminders`、`deletion queue`、`milestone files`、`presence`、`rate-limit`、`sprint`、`checklist`、`collaborators`、`task writes` 等）。失败原因是本机无可用 PostgreSQL（`AggregateError` 连接失败），**不是代码逻辑缺陷**。docker 文档要求数据库与 uploads 备份、独立库运行迁移，本机 Docker 引擎未启动、Postgres 服务启动需管理员权限，故未在此环境实跑数据库用例。上线前应在有库的服务器/测试环境完整跑一遍。

## 四、发现的问题与修复

### 1. 时区口径不统一（功能性隐患，已修复）

- **问题**：后端日报/日历 API 缺省按东八区取「今天」（`Date.now() + 8h`），但前端三个组件用浏览器本地时区（`getFullYear/getMonth/getDate`）生成日期键。浏览器处于非东八区（如出国、系统时区设错）时，日报查错日期、日历高亮错天、截止判断偏移。
- **修复**：统一复用项目既有的东八区工具 `dayKey(new Date().toISOString())`（`Asia/Hong_Kong` = 北京时间），改动 `DailyReportCard.tsx`、`HomeCalendar.tsx`、`TodayPanel.tsx` 三处。不改后端逻辑，口径与 `dueOn`、`deadline reminders` 完全一致。

### 2. ESLint 4 个问题（已修复）

- `app/api/auth/me/route.ts`、`app/api/teams/[id]/labels/route.ts` 两处 `catch (error: any)` → 改为代码库既有惯用写法 `catch (caught: unknown)` + 结构化断言（与 `register`、`projects` 一致）。
- `tests/task-transactions.test.mjs` 未使用的 `and` 导入与 `taskLabels` 解构 → 清理。

### 3. 缺少 `test` 脚本（已修复）

`package.json` 新增 `"test": "node --import tsx --test tests/*.test.*"`。此前无统一测试入口，且 `.ts` 测试直接 `node --test` 会因无扩展名导入报错，必须经 `tsx` 加载。

### 4. 未发现问题的检查项

- 删除的 `app/home.css`、`app/workspace/page.tsx` 无残留引用（`layout.tsx` 引用的是 `workspace-theme.css`，路由已收敛到首页）——非回归。
- 日报/日历接口通过 `requireUser(request)` 鉴权，走 Middleware 保护——无越权。

## 五、建议（团队决策，非本分支代码改动）

1. 上线前在有 PostgreSQL 的环境跑完 12 个数据库用例，并走 docker 文档的迁移脚本清单。
2. PDF 里「异常报错处理 / 丰富动效」属必要优化，可作为下一工作包。
3. 该分支基于 `功能/ai-home-dashboard`；若要并入主干，按 docker 文档的发布流程（备份 → 迁移 → build → 重启）操作，服务器端口 5432/3000 不可公网暴露。
