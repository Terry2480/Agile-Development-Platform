# 01 基础工作台

候选提交：`feat-add-student-workspace-foundation`

## 目标

提供面向学生的项目入口和项目类型基础模型，覆盖课程项目、大创项目、竞赛项目和科研项目。

## 参考文件

平行实现中的主要文件：

- `implementation/src/app/page.tsx`
- `implementation/src/app/(app)/projects/page.tsx`
- `implementation/src/db/schema.ts`
- `implementation/src/lib/project.ts`
- `implementation/src/app/demo/page.tsx`

## 依赖

- Next.js / React / Tailwind
- PostgreSQL / Drizzle
- `DATABASE_URL`
- `AUTH_SECRET`

## 采用建议

适合作为第一批评估内容。队友可以先运行 `implementation`，确认页面和项目类型符合课程展示，再决定是否把对应逻辑移入根目录。
