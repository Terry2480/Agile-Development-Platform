# 02 用户与团队

候选提交：`feat-add-student-authentication-and-teams`

## 目标

让学生注册、登录、创建团队、通过邀请码加入团队，并查看团队成员和基础角色。

## 参考文件

- `implementation/src/app/(auth)/login/`
- `implementation/src/app/(auth)/register/`
- `implementation/src/app/(app)/teams/`
- `implementation/src/lib/auth.ts`
- `implementation/src/lib/user.ts`
- `implementation/src/lib/team.ts`
- `implementation/src/db/schema.ts`

## 依赖

- 基础工作台
- Auth.js
- 用户、团队和团队成员表
- `DATABASE_URL`
- `AUTH_SECRET`

## 采用建议

先确认角色权限和邀请码流程，再接入项目、任务和资料功能。不要只复制页面而不复制服务端权限校验。
