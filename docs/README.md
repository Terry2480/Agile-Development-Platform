# 项目文档索引

更新：2026-11-15。文档系统隔离版开发及开发侧检查完成，组员人工验收、生产发布分别记录；成员私聊仍属后续工作。

## 组员验收

| 文档 | 用途 |
| --- | --- |
| [文档系统验收指南与记录单](document-system-acceptance.md) | **本次验收入口**：功能、环境、四类账号、34 条用例及预期、缺陷和签收表 |
| [交付与验证记录](document-delivery-progress.md) | 已执行的检查、实际结果、参考截图/PDF及未验证边界 |

## 需求与开发

| 文档 | 用途 |
| --- | --- |
| [第二阶段需求](phase-2-requirements.md) | 文档系统、后续私聊与路线图的范围及验收标准 |
| [实施计划](phase-2-implementation-plan.md) | 工作包、依赖与当前阶段 |
| [文档设计决策](phase-2-document-design.md) | 用户已确认的 Q1—59，Q56 移动端新增适配暂缓 |
| [技术设计与 API](phase-2-document-technical-spec.md) | 数据表、引用、锁、实际请求字段和接口地图 |
| [桌面交互方案](phase-2-document-ui-design.md) | 已认可的入口、目录、编辑及辅助流程 |
| [原有项目技术全景](v1-technical-overview.md) | 原有模块、目录、API 和协作接手基础；文档新增功能以上述技术设计为准 |

## 部署与运维

| 文档 | 用途 |
| --- | --- |
| [文档系统部署、迁移与恢复](document-system-release.md) | 本批增量 001—005、回填/cutover、浏览器与存储依赖、队列及回退边界 |
| [实际服务器交接](server-handoff.md) | 现有服务器路径、端口、服务及发布操作；执行前核对现场状态 |
| [通用部署与升级](deployment.md) | 原功能数据库升级、运行环境、HTTPS、备份和进程管理 |
| [登录保护](login-protection.md) | Origin、Cookie、登录限流 |
| [附件一致性](file-cleanup.md) | 文件持久化及清理队列，文档资源还需遵循本批部署说明 |
| [通知](notifications.md) | 指派、提及、评论与截止提醒 |
| [聊天时间](chat-timezone.md) | 旧聊天数据时区核对及迁移 |

## 验证入口

人工审查使用 `npm run setup:documents`、`npm run dev:documents`，前提与账号见验收指南。自动验证：`npm run test:baseline`、`npm run test:documents`、`npm run test:document-api`、`npm run test:document-ui`；各自隔离库及浏览器前提必须先准备，不改到普通开发/生产库运行。

早期基线记录、初版 API 草案、分阶段实现笔记和旧测试汇总已合并到当前技术设计、验收指南、交付记录及部署说明，不再维护平行版本。测试实现保留在 `tests/`，增量 SQL 保留在 `db/migrations/`，验收参考证据保留在 `document-evidence/`。
