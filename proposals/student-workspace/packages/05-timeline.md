# 05 项目时间线

候选提交：`feat-add-project-timeline`

## 目标

按开始日期、截止日期和里程碑展示项目任务，标记逾期任务并显示当前日期位置。

## 参考文件

- `implementation/src/app/(app)/projects/[projectId]/timeline/page.tsx`
- `implementation/src/app/(app)/projects/[projectId]/task-card.tsx`
- `implementation/src/lib/task.ts`
- `implementation/src/db/schema.ts`

## 依赖

- 项目、任务和里程碑
- 任务开始日期和截止日期字段
- `DATABASE_URL`

## 采用建议

适合项目汇报和阶段检查。它复用任务日期字段，不需要单独建立甘特图核心数据表。
