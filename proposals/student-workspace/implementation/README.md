# AgileCampus 学生项目工作台平行实现

这是候选实现的独立副本，位于仓库的 `proposals/student-workspace/implementation` 目录。

它不会替换仓库根目录的队友代码，也不会作为根目录 Next.js 应用自动运行。需要测试时，请进入当前目录执行命令。

## 本地运行

```powershell
npm install
copy .env.example .env
npm run db:push
npm run dev -- -p 3001
```

数据库和环境变量要求见上级目录的：

- `../integration-notes/database.md`
- `../integration-notes/environment.md`

## 目录说明

- `src/app`：页面和 API 路由。
- `src/db`：Drizzle 数据库连接和 schema。
- `src/lib`：认证、团队、项目、任务、资料和可选扩展逻辑。
- `tests`：业务测试。

## 构建说明

本平行实现使用系统字体，不依赖构建时访问 Google Fonts，便于在网络不稳定的 Windows 环境中执行：

```powershell
npm run lint
npm run build
```

AI、Agent API 和飞书变量可以留空；基础学生项目管理流程不依赖这些服务。
