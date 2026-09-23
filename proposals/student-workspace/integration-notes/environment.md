# 环境说明

## 基础环境

- Node.js 20 或更高版本。
- PostgreSQL 16，或已启动的 Docker Desktop。
- npm。

## 基础变量

复制 `.env.example` 为本地 `.env`，至少配置：

```text
DATABASE_URL=postgresql://agilecampus:agilecampus_dev@localhost:5432/agilecampus
AUTH_SECRET=本地随机密钥
AGILECAMPUS_URL=http://localhost:3001
```

## 可选变量

只有采用对应扩展时才需要：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`
- `CRON_SECRET`

不把这些变量的真实值提交到 GitHub。

## 启动

```powershell
npm install
npm run db:push
npm run dev -- -p 3001
```

打开：

```text
http://localhost:3001
```
