# 04 项目资料

候选提交：`feat-add-project-resources-and-documents`

## 目标

为项目提供说明、开题材料、会议纪要、周报和研究记录的集中管理与编辑入口。

## 参考文件

- `implementation/src/app/(app)/projects/[projectId]/documents/`
- `implementation/src/app/(app)/teams/[teamId]/resources/`
- `implementation/src/lib/document.ts`
- `implementation/src/lib/document-templates.ts`
- `implementation/src/lib/resource.ts`
- `implementation/src/db/schema.ts`

## 依赖

- 项目与任务
- 项目资料和文档表
- `DATABASE_URL`

## 采用建议

适合大创、科研和周期较长的项目。课程项目若只需要看板，可以暂不采用。
