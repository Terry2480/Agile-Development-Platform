# 找回密码功能（terry/password-recovery）

从最新分支 `terry/guide-entry` 新建，不改动任何已有分支。给登录页增加「忘记密码？」找回密码能力。

## 功能流程

1. 登录页点击「忘记密码？」→ 输入注册邮箱 → 「获取验证码」
2. 输入 6 位验证码 + 新密码 → 「确认重置」→ 自动回到登录页用新密码登录

## 演示模式说明（重要）

项目是课程原型，**没有接入邮件服务**。因此在演示模式下（环境变量 `RESET_DEV_MODE` 不等于 `false`），验证码会直接显示在页面上（蓝色虚线框里），方便课堂演示完整流程，无需真实邮箱。

> 生产环境接入 SMTP 后，把 `RESET_DEV_MODE=false`，并自行在 `app/api/auth/forgot-password/route.ts` 里改为发送邮件，验证码就不会再返回给前端。

## 安全设计

- 邮箱不存在也返回统一提示，不暴露账号是否注册（防枚举）
- 按来源 + 账号双重限流
- 验证码 10 分钟有效、最多猜 5 次、用后即废、生成新码时旧码作废
- 数据库只存验证码 sha256 摘要，不存明文
- 重置成功后删除该用户所有会话，强制用新密码重新登录

## 数据库变更

新增表 `password_reset_tokens`，迁移脚本 `db/add-password-reset.ts`（已在本机数据库执行）：

```bash
npm run db:add-password-reset   # CREATE TABLE IF NOT EXISTS，幂等
```

## 验证结果

- lint 通过、build 通过、新增 5 个单元测试全过
- curl 实测：发送验证码 / 防枚举 / 错误码 / 正确重置 / 防重放 / 旧密码失效 / 新密码登录 / 重置后旧会话失效 —— 全部符合预期
- 备注：联调时测试账号 `beta@stu.edu.cn` 的密码被临时改动，已恢复为 `123456`

## 相关文件

- `db/schema.ts` + `db/add-password-reset.ts`：验证码表
- `lib/password-reset.ts`：纯逻辑（生成/摘要/校验）
- `app/api/auth/forgot-password/route.ts`：发送验证码
- `app/api/auth/reset-password/route.ts`：重置密码
- `app/login/page.tsx`：找回密码界面
- `app/globals.css`：样式
- `tests/password-reset.test.mjs`：单元测试
