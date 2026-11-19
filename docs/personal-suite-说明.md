# 个人效率中心（terry/personal-suite）

从 `terry/password-recovery`（含之前的找回密码功能）新建分支，不动任何已有分支。把**日历 / 待办 / 记事**整合成一个独立功能，并加全局入口，任何页面都能一键进入——对标 Google Calendar + Tasks + Keep。

## 怎么用

- 登录后在任意页面点右下角悬浮按钮「**效率中心**」，或直接访问 `/suite`
- 页面顶部三个 Tab：
  - **日历**：月历网格（周一起始），聚合「项目任务截止 + 里程碑 + 个人待办截止日」，点日期看当天安排，可切月/回今天
  - **待办**：输入框回车即添加，可设截止日、勾选完成、删除；完成的待办不再进日历
  - **记事**：卡片式随手记，可编辑标题/正文、置顶、换 5 种颜色、删除（Keep 风格）
- 悬浮入口在：首页、工作台、新手导引、个人设置等所有页面可见；登录页和效率中心自身不显示；未登录用户不显示

## 为什么要新建数据表

现有「待办」必须挂在某个项目下、「云文档」是项目协作文档，都不是 Google Tasks/Keep 那种个人随手记。所以新增了两张个人表（按 `user_id` 严格隔离）：

| 表 | 说明 |
|---|---|
| `personal_todos` | 个人待办：标题 / 备注 / 完成状态 / 截止日 |
| `personal_notes` | 个人记事：标题 / 正文 / 颜色 / 置顶 |

迁移脚本 `db/add-personal-suite.ts`（已在本机执行）：

```bash
npm run db:add-personal-suite   # CREATE TABLE IF NOT EXISTS，幂等
```

## 相关文件

- `app/suite/page.tsx` + `suite.css`：三合一独立页面
- `components/SuiteLauncher.tsx`：全局悬浮入口
- `app/layout.tsx`：挂载全局入口（唯一改动是一行 import + 一处渲染）
- `app/api/suite/todos/route.ts`、`app/api/suite/notes/route.ts`：CRUD 接口
- `db/schema.ts` + `db/add-personal-suite.ts`：数据表
- `package.json`：迁移命令

## 安全与验证

- 所有接口 `requireUser` 鉴权；所有查询/更新/删除都带 `user_id` 条件，跨用户操作返回 404（已实测）
- lint 通过、build 通过、测试通过（77 项中 75 通过，2 项为基线既有的事务相关失败，与本改动无关）
- curl 实测：未登录 401、创建/列表/更新/删除、跨用户隔离、删除后数据落库 —— 全部符合预期
- 测试用临时账号已清理，数据表中无残留
