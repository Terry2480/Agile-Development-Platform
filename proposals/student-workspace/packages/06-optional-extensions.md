# 06 可选扩展

候选提交：

- `feat-add-optional-ai-project-assistant`
- `feat-add-optional-agent-api`
- `feat-add-optional-feishu-integration`

## 包含内容

- AI 项目助手和对话式任务拆解。
- Personal API Token 和 Agent 写入 API。
- 飞书 OAuth、飞书卡片、提醒和绑定。

## 参考文件

- `implementation/src/app/api/chat/`
- `implementation/src/app/api/agent/`
- `implementation/src/app/api/auth/feishu/`
- `implementation/src/app/api/cron/`
- `implementation/src/lib/agent/`
- `implementation/src/lib/feishu.ts`
- `implementation/src/lib/notify.ts`

## 额外依赖和变量

- `DEEPSEEK_API_KEY`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`
- `CRON_SECRET`

## 采用建议

默认不采用。先完成基础学生项目流程，再根据课程展示或团队需求单独评估每个扩展。
