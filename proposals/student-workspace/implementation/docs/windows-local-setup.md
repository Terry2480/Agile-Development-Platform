# Windows 本地运行指南

这份说明适用于没有启用 WSL，或 Docker Desktop 暂时无法启动的 Windows 开发环境。

## 1. 安装 PostgreSQL 16

使用管理员 PowerShell 执行：

```powershell
winget install --id PostgreSQL.PostgreSQL.16 --exact --source winget `
  --accept-source-agreements --accept-package-agreements
```

安装时记住 PostgreSQL 管理员密码。默认端口使用 `5432`。

确认服务正常：

```powershell
Get-Service postgresql-x64-16
& "C:\Program Files\PostgreSQL\16\bin\pg_isready.exe" -h localhost -p 5432
```

看到 `accepting connections` 即表示数据库服务可用。

## 2. 创建 AgileCampus 数据库

下面命令假设 PostgreSQL 管理员账号是 `postgres`。把 `<管理员密码>` 替换成安装时设置的密码：

```powershell
$env:PGPASSWORD="<管理员密码>"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

& $psql -h localhost -U postgres -d postgres `
  -c "CREATE ROLE agilecampus LOGIN PASSWORD 'agilecampus_dev';"
& $psql -h localhost -U postgres -d postgres `
  -c "CREATE DATABASE agilecampus OWNER agilecampus;"
& $psql -h localhost -U postgres -d postgres `
  -c "CREATE DATABASE agilecampus_test OWNER agilecampus;"
```

如果提示角色或数据库已经存在，可以跳过对应的创建命令。

验证应用账号：

```powershell
$env:PGPASSWORD="agilecampus_dev"
& $psql -h localhost -U agilecampus -d agilecampus `
  -c "select current_user, current_database();"
```

## 3. 配置项目

在项目根目录创建 `.env`。该文件已被 `.gitignore` 忽略，不能上传到 GitHub：

```env
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus
AUTH_SECRET=请替换为随机长字符串
AGILECAMPUS_URL=http://localhost:3001
CRON_SECRET=请替换为随机长字符串
```

测试库使用 `.env.test`：

```env
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus_test
AUTH_SECRET=test-secret-not-for-production
AGILECAMPUS_URL=http://localhost:3001
CRON_SECRET=test-cron-secret-not-for-production
```

生成随机密钥：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. 初始化表结构并启动

在项目目录执行：

```powershell
npm ci
npm run db:push
npm run db:push:test
npm run dev -- -p 3001
```

然后打开：

```text
http://localhost:3001/login
```

没有账号时进入 `/register` 注册。登录后可以创建团队、项目、任务、项目资料和时间线。

## 5. Windows 上的 Next.js 遥测报错

如果看到类似下面的错误：

```text
EXDEV: cross-device link not permitted
```

这是 Next.js 遥测配置文件的本机写入问题，不是 AgileCampus 数据库错误。当前终端执行：

```powershell
$env:NEXT_TELEMETRY_DISABLED="1"
npm run dev -- -p 3001
```

如果希望以后所有新终端都默认关闭遥测：

```powershell
[Environment]::SetEnvironmentVariable(
  "NEXT_TELEMETRY_DISABLED",
  "1",
  "User"
)
```

设置后重新打开 PowerShell 或 VS Code 终端。

## 6. 常用检查

```powershell
Get-Service postgresql-x64-16
Get-NetTCPConnection -LocalPort 5432
git status
npm run lint
npm test
```

`.env`、`.env.test`、数据库密码、`AUTH_SECRET`、`CRON_SECRET`、DeepSeek Key 和飞书 Secret 都不应提交到仓库。
