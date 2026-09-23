# 数据库说明

## 本地开发数据库

默认连接：

```text
postgresql://agilecampus:agilecampus_dev@localhost:5432/agilecampus
```

测试数据库：

```text
postgresql://agilecampus:agilecampus_dev@localhost:5432/agilecampus_test
```

## 表结构范围

基础版本需要用户、团队、团队成员、项目和任务相关表。

项目任务版本追加：

- 里程碑
- 子任务关系
- 任务依赖
- 标签和任务标签关系

资料版本追加：

- 项目资料
- 项目文档

可选扩展追加：

- 对话和消息
- Personal API Token
- 资源占用
- 飞书绑定字段

## 同步要求

采用数据库相关功能后，在目标项目根目录执行：

```powershell
npm run db:push
```

测试环境执行：

```powershell
npm run db:push:test
```

不要使用会清空数据卷的命令，除非团队明确同意重置本地数据库。
