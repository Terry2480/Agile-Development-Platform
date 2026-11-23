# 功能包地图

## 基础工作台

提交：`feat: add student workspace foundation`

- 面向学生的项目总览和项目类型入口。
- 支持课程、大创、竞赛、科研四类项目。
- 提供项目状态、描述、负责人和时间范围等基础字段。
- 适合作为课程项目和学生项目的第一版演示。
- 依赖：Next.js、React、Tailwind、PostgreSQL、Drizzle。
- 环境变量：`DATABASE_URL`、`AUTH_SECRET`、`AGILECAMPUS_URL`。

## 用户与团队

提交：`feat: add student authentication and teams`

- 注册、登录和退出。
- 创建团队、邀请码加入团队。
- 查看成员和基础角色。
- 角色包括 `admin`、`teacher`、`student`。
- 依赖：基础工作台和 Auth.js。
- 数据库：用户、团队、团队成员表。

## 项目与任务

提交：`feat: add project task workspace`

- 创建项目、里程碑、任务和子任务。
- 设置负责人、优先级、状态和截止日期。
- 使用看板查看任务进度。
- 支持任务筛选、标签和基础权限控制。
- 依赖：用户与团队。
- 数据库：项目、里程碑、任务、任务依赖和标签表。

## 项目资料

提交：`feat: add project resources and documents`

- 项目说明、开题材料、会议纪要、周报和研究记录。
- 提供文档模板、编辑和预览入口。
- 适合管理大创、科研和长期开发项目资料。
- 依赖：项目与任务。
- 数据库：项目文档和项目资料表。

## 时间线

提交：`feat: add project timeline`

- 按开始日期、截止日期和里程碑展示任务。
- 标记逾期任务和当前日期。
- 适合汇报项目周期、检查阶段进度。
- 依赖：项目、任务和里程碑。
- 数据库：复用任务日期字段，不增加独立核心表。

## 可选扩展

以下提交默认不要求采用：

- `feat: add optional ai project assistant`
- `feat: add optional agent api`
- `feat: add optional feishu integration`

这些功能分别涉及 DeepSeek、Personal API Token、外部程序写入接口和飞书应用配置。若团队只做课程项目或学生项目管理，可暂不采用。

## 推荐采用顺序

1. 基础工作台
2. 用户与团队
3. 项目与任务
4. 项目资料
5. 时间线
6. AI、Agent API、飞书扩展
