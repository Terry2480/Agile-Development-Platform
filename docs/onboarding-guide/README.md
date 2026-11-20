# AgileCampus 新手导引（Onboarding Guide）

> 本分支 `terry/onboarding-guide` 基于 `terry/v63-bugfix`（当前功能最全、已修 bug 的版本）。
> 全部为**新增文件**，未改动任何已有页面、组件或分支。由 Step-5-Preview 模型（WorkBuddy）生成。

## 一、这是什么

面向第一次进入平台的同学，一个 **8 步交互式新手教程**，用「说明 + 要点 + 界面示意（脉冲高亮「点哪里」）+ 小提示」的结构，带新手走完从注册到日常使用的完整路径。

8 步内容（全部对齐平台真实功能）：

| 步骤 | 主题 | 对应真实功能/路由 |
|---|---|---|
| 1 | 认识平台 | 首页 `/` 三步开始、能力矩阵；工作台 `/workspace` |
| 2 | 注册登录 | 学工号注册、scrypt 加盐哈希、7 天会话（`/login`） |
| 3 | 加入团队 | 团队管理、邀请码、owner/admin/member 三种角色 |
| 4 | 建项目迭代 | 项目管理、课程选择、迭代周期 |
| 5 | 任务看板 | 待开始/进行中/已完成三列、优先级、截止、检查清单、拖拽 |
| 6 | 协作沟通 | 项目群聊（@提及/引用/附件）、私信、云文档 |
| 7 | 今日视图 | 进度条、临期提醒、AI 日报、项目日历 |
| 8 | 效率技巧 | Ctrl/⌘+K 命令面板、日/夜主题切换、通知铃铛 |

交互设计要点：
- 左侧步骤导航可自由跳转，完成打勾，避免线性教程的挫败感
- 顶部进度条 + 底部圆点双反馈，随时知道「我在哪、还剩多少」
- 每步一张模拟界面图，脉冲高亮圈直接指给人看「点这里」
- 上一步/下一步 + 完成页 + 再看一遍，闭环完整
- 响应式：窄屏自动折叠侧栏、单列排版
- 无障碍：语义化按钮、`aria-label`、禁用态、键盘可达

## 二、两种查看方式

### 方式 A：在平台内访问（真实页面）

新增的 Next.js 路由是 **`app/guide/page.tsx`**（配套 `app/guide/guide.css`），启动平台后访问：

```
http://localhost:3000/guide
```

启动方式（与其他页面一致）：
```bash
cd Agile-Development-Platform-ai-dashboard
git checkout terry/onboarding-guide
npm ci --include=dev          # 本地已装可跳过
docker compose up -d          # 起 PostgreSQL
# .env.local 配好 DATABASE_URL
npm run dev
```

该路由已被 `next build` 编译验证为静态页（构建输出 `○ /guide`），`tsc --noEmit` 与 `eslint` 均 0 问题。

> 说明：为遵守「不改动已有内容」，我没有在首页/工作台的导航里加「新手导引」入口链接。
> 团队若想加入口，只需在导航组件里加一个指向 `/guide` 的链接即可（这一步留给团队决定）。

### 方式 B：静态预览（无需后端，双击即看）

`docs/onboarding-guide/preview.html` 是同样 8 步内容的纯前端复刻，**双击用浏览器打开即可体验完整交互**（步骤切换、进度、高亮、完成页）。适合课程汇报演示，或在没有数据库的机器上看效果。

## 三、文件清单

```
app/guide/page.tsx                     # 平台内导引页面（React/Next.js）
app/guide/guide.css                    # 独立样式（og- 前缀，不污染全局）
docs/onboarding-guide/preview.html     # 静态交互预览（双击即看）
docs/onboarding-guide/README.md        # 本说明
```

## 四、扩展建议（可选）

- 首次登录自动弹导引：在 `app/workspace/page.tsx` 读一个 `localStorage` 标记，首次进入跳 `/guide`。需团队确认后再改。
- 每步「试试看」按钮深链到真实位置（`/workspace#tasks` 等锚点已预留）。
- 导引完成状态写入用户表，做「新手完成率」埋点。
