# AgileCampus 敏捷校园

面向大学生课程项目的敏捷协作工具，支持团队分工、任务、聊天、教学周里程碑、汇报摘要与课程文件。

## 文档系统验收（2026-11-15）

已实现本批文档功能，当前处于组内人工验收阶段，尚未生产发布。组员请从 [文档系统验收指南与记录单](docs/document-system-acceptance.md) 开始：包含功能清单、四种账号、34 条人工用例、验证命令与缺陷模板。[开发验证记录](docs/document-delivery-progress.md) 与 [部署/迁移/恢复说明](docs/document-system-release.md) 分别记录已验证内容和后续上线要求。

```powershell
npm ci
npm run setup:documents
npm run dev:documents
```

需先配置本机 PostgreSQL 连接。上述命令固定使用隔离审查库和 `uploads-document-review`，不修改普通开发库；访问 http://127.0.0.1:3112。账号及初始密码见验收指南。本轮功能与验收以验收指南为入口，技术与运维文档见下方索引。

## 本地开发

协作成员接手请先阅读 [第一版技术全景与第二版接手指南](docs/v1-technical-overview.md)，了解模块、目录、API、数据库关系与第二版协作入口。

第二阶段实施范围与验收标准见 [第二版需求基线](docs/phase-2-requirements.md)，本轮先交付文档系统，再交付成员私聊；甘特与拖拽不纳入本轮。

逐步实施时对照 [第二阶段实施路径与执行记录](docs/phase-2-implementation-plan.md)，按基线核对、数据与接口设计、功能开发、验收的顺序推进。

文档系统的已确认规则和底层成果见 [设计文档](docs/phase-2-document-design.md)，具体数据库与 API 方案见 [技术设计基线](docs/phase-2-document-technical-spec.md)。

文档导航见 [项目文档索引](docs/README.md)。验收步骤集中在验收指南，实际检查结果集中在交付记录，迁移及兼容切换集中在部署说明，避免分阶段记录重复或过期。

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
- [站内通知与截止提醒](docs/notifications.md)：提醒时机、去重和已读通知清理。

生产采用常驻 Node.js 服务和 PostgreSQL；附件保存在工作目录的 `uploads/`。当前生产版要求 HTTPS，不能直接使用 `http://服务器IP` 进行生产登录。环境配置与附件不进入 Git，应在服务器单独保存。

数据库升级按部署指南核对现有结构并执行缺失迁移。本地数据库更新不会随代码推送同步到服务器。
