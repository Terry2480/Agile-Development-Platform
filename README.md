# AgileCampus 敏捷校园

面向大学生课程项目的敏捷协作工具，支持团队分工、任务、聊天、教学周里程碑、汇报摘要与课程文件。

## 本地开发

准备 Node.js（Next.js 最低要求 20.9）和 PostgreSQL，在 `.env.local` 设置 `DATABASE_URL`。

```bash
npm ci --include=dev
npm run dev
```

数据库初始化及服务器部署请按照下方文档执行，不要在已有数据库运行演示数据初始化脚本。

## 部署与维护

- [实际服务器部署交接](docs/server-handoff.md)：本项目服务器的真实路径、端口、systemd、IP HTTPS、备份与发布步骤；新会话接手先读。
- [服务器部署与版本升级](docs/deployment.md)：数据库更新、HTTPS、上传限制、进程管理、备份及验收。
- [聊天时间修复](docs/chat-timezone.md)：检查服务器旧消息时区，并迁移聊天时间字段。
- [登录保护](docs/login-protection.md)：可信地址、Cookie 和限流。
- [附件一致性](docs/file-cleanup.md)：文件持久化、撤回与后台清理。

生产采用常驻 Node.js 服务和 PostgreSQL；附件保存在工作目录的 `uploads/`。当前生产版要求 HTTPS，不能直接使用 `http://服务器IP` 进行生产登录。环境配置与附件不进入 Git，应在服务器单独保存。

本次升级新增成员多分工标签，服务器启动新版前需执行 `npm run db:add-member-duties`；聊天时间字段需按部署文档检查。本地数据库更新不会随代码推送同步到服务器。
