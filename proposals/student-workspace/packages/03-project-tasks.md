# 03 项目与任务

候选提交：`feat-add-project-task-workspace`

## 目标

提供项目、里程碑、任务、子任务、标签、看板和任务筛选，支持学生管理课程、大创、竞赛和科研项目的日常进度。

## 参考文件

- `implementation/src/app/(app)/teams/[teamId]/projects/`
- `implementation/src/app/(app)/projects/[projectId]/`
- `implementation/src/lib/project.ts`
- `implementation/src/lib/task.ts`
- `implementation/src/lib/label.ts`
- `implementation/src/lib/board-columns.ts`
- `implementation/src/lib/board-filters.ts`

## 依赖

- 基础工作台
- 用户与团队
- 项目、任务、里程碑和标签表
- `@dnd-kit/core`

## 采用建议

这是课程项目敏捷开发平台的核心候选包，建议优先评估。采用时必须同步服务端权限、数据库字段和任务状态逻辑。
