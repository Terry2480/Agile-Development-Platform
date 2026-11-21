# AgileCampus 业务后端 API 文档

> 认证方式与 v1 相同：登录后 Cookie `agile_session`（httpOnly，7 天）自动携带，无需手动设置。
> 所有接口返回 JSON；错误统一为 `{ "error": "中文提示" }`，状态码 400（参数）/ 401（未登录）/ 403（无权限）/ 404（不存在）/ 409（冲突）/ 500（服务器异常）。
> 日期字段统一 `YYYY-MM-DD` 字符串；时间戳为 ISO 字符串。

## 通用约定

- **任务编号**：`项目key-序号`（如 `AGI-011`），创建时后端在项目内自动递增分配。
- **任务状态**：`todo`（待开始）/ `doing`（进行中）/ `done`（已完成）。
- **优先级**：`low` / `medium` / `high`。
- **团队角色**：`owner`（创建者，最高）/ `admin`（管理员）/ `member`（成员）。团队成员可访问该团队全部项目；成员管理、删除团队/项目、置顶消息、改标签需要 `admin` 及以上；解散团队仅 `owner`。
- **@提及语法**：在聊天消息或评论中写 `@名称` 或 `@学工号`（如 `@陈测试`、`@2023210315`），与团队成员匹配成功后对方会收到站内通知。
- **展示名**：用户名称未填时回落学工号（接口里的 `displayName` 字段）。

## 快速上手（本地）

```bash
docker compose up -d        # 启动 PostgreSQL
npm run db:push             # 同步表结构（改 db/schema.ts 后必须执行）
npm run db:seed             # 写入演示数据（幂等，可重复运行）
npm run dev                 # 启动 http://localhost:3000
```

## 接口一览

### 认证（v1 原有，不变）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（email/password/studentId），成功即登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET/PUT | `/api/auth/me` | 我的信息 / 更新个人资料 |

### 工作台统计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/overview` | `{ teamCount, projectCount, taskTotal, taskDone, myTodo, myDoing }` |
| GET | `/api/search/messages?q=` | **全局消息搜索**（Ctrl+K「聊天」分组）：跨我所在团队的项目频道与我的私信各取新→旧 5 条，不含已撤回 |

### 团队

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/teams` | 登录 | 我的团队列表（含 memberCount/projectCount/我的角色） |
| POST | `/api/teams` | 登录 | `{ name, description? }` 新建，创建者为 owner |
| GET | `/api/teams/[id]` | 成员 | 详情 + 成员列表 + 我的角色 |
| PUT | `/api/teams/[id]` | admin | 改名 / 简介 |
| DELETE | `/api/teams/[id]` | owner | 解散（级联删除团队全部数据） |
| POST | `/api/teams/[id]/members` | admin | `{ email, role?: "admin"\|"member" }` 按邮箱添加，自动加入团队全部项目 |
| PUT | `/api/teams/[id]/members/[userId]` | owner | `{ role }` 调整角色 |
| DELETE | `/api/teams/[id]/members/[userId]` | admin/本人 | 移除成员 / 退出团队（owner 不能退出） |

### 项目

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/projects?teamId=&q=&starred=1` | 登录 | 项目列表：含任务统计、成员头像、当前 Sprint、是否收藏 |
| POST | `/api/projects` | 成员 | `{ teamId, name, key, description? }`；key 为 2-6 位大写字母/数字（如 WEB），团队内唯一；团队全员自动成为项目成员 |
| GET | `/api/projects/[id]` | 成员 | 详情：团队、成员、Sprint 列表、团队标签、任务统计、星标 |
| PUT | `/api/projects/[id]` | admin | 改名/简介/归档 `{ name?, description?, status?: "active"\|"archived" }` |
| DELETE | `/api/projects/[id]` | admin | 删除项目（级联） |
| POST | `/api/projects/[id]/star` | 成员 | 切换收藏 `{ starred: bool }` |

### Sprint（迭代）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/projects/[id]/sprints` | 成员 | 全部迭代 |
| POST | `/api/projects/[id]/sprints` | 成员 | `{ name, goal?, startsOn?, endsOn?, status? }`；置 active 自动停用其他活跃迭代 |
| PUT | `/api/sprints/[id]` | 成员 | 编辑 / 启动 / 完成 |

### 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks?projectId=&status=&priority=&assigneeId=&sprintId=&labelId=&mine=1&q=&limit=` | 筛选列表（不传 projectId 则查我所有团队的）；`mine=1` 只看指派给我的 |
| POST | `/api/tasks` | `{ projectId, title, description?, status?, priority?, assigneeId?, dueOn?, sprintId?, parentTaskId?, labelIds? }`；返回含 `code`（如 AGI-011）；指派会通知负责人 |
| GET | `/api/tasks/[id]` | 详情：负责人、创建者、标签、评论、子任务、附件、活动记录 |
| PUT | `/api/tasks/[id]` | 更新任意字段；状态/负责人/优先级/截止日变更自动写项目日志，指派触发通知 |
| DELETE | `/api/tasks/[id]` | 删除（级联子任务/评论/标签/附件记录） |
| GET/POST | `/api/tasks/[id]/comments` | 评论；POST `{ content }`，@提及和任务负责人会收到通知 |

### 项目聊天

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/[id]/chat` | 最新 50 条（时间正序）；`?afterId=N` 增量拉取；`?beforeId=N` 向前翻页（加载更早/搜索跳转）；`?pinned=1` 全部公告（新→旧） |
| POST | `/api/projects/[id]/chat` | `{ content, replyToId?, taskId? }`；消息可回复、可关联任务卡片；@提及触发通知 |
| GET | `/api/projects/[id]/chat/search` | **聊天记录搜索**：`?q=&type=all\|text\|link\|file\|author&authorId=`（人名需 authorId）；原文/文件名/作者名综合或分类过滤，新→旧最多 50 条（不含已撤回） |
| GET | `/api/projects/[id]/chat/summary` | **今日要点**（规则式摘要）：`?date=YYYY-MM-DD` 默认今天；消息量/参与人/提及任务编号/文件/链接/待跟进问题数 |
| POST | `/api/chat/[id]/like` | **表情回应**（切换）：`{ emoji }`，支持 👍🎉😂🙏💪❤️；同消息每人每表情一次，再点取消 |
| POST | `/api/chat/[id]/recall` | **撤回**（仅本人，发送后 2 分钟内）：正文清空、取消置顶，双方显示「撤回了一条消息」 |
| PUT | `/api/chat/[id]/pin` | admin `{ pinned: bool }` 置顶为公告；**公告可多条**，频道顶部展示最新一条 |

消息对象包含：`author.displayName`、`reactions`（按 emoji 分组：emoji/count/mine）、`replyTo`（摘要）、`task`（关联任务卡片）、`attachment`（文件消息）、`recalled`（撤回标记，撤回后仅显示占位灰字）。

### 文件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/[id]/files?taskId=` | 文件列表 |
| POST | `/api/projects/[id]/files` | `multipart/form-data`：`file`（≤20MB）+ 可选 `taskId`；存本地 `uploads/`（已 gitignore） |
| GET | `/api/files/[id]` | 下载（校验团队成员身份，中文文件名正常） |

### 私聊（v5 新增）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/dm` | 登录 | 我的会话列表（对方资料、最后消息、未读数、置顶/免打扰）；**置顶的排最前**，其余按最近活跃倒序（最近对话的对象自动位于置顶下第一条）；免打扰会话不计入 unreadTotal |
| POST | `/api/dm` | 登录 | `{ peerId }` 与同团队成员打开（或创建）一对一会话；非同团队返回 403；重新发起会自动取消我方的隐藏 |
| GET | `/api/dm/contacts` | 登录 | 可私聊的联系人 = 我所有团队的其他成员（去重，在线优先排序） |
| GET | `/api/dm/[id]/messages?afterId=/beforeId=` | 会话双方 | 最新 80 条（时间正序）；`afterId` 增量；`beforeId` 向前翻页；含 `attachment`（文件消息）、`replyTo`（引用）、`recalled` |
| GET | `/api/dm/[id]/messages/search` | 会话双方 | **聊天记录搜索**：`?q=&type=all\|text\|link\|file\|author&authorId=`（人名限会话双方）；结构同消息列表，新→旧最多 50 条（不含已撤回） |
| POST | `/api/dm/[id]/messages` | 会话双方 | `{ content, replyToId? }`（≤2000 字，支持引用回复）；通知为同批未读合并提醒；对方隐藏过会话自动恢复 |
| POST | `/api/dm/[id]/messages/[messageId]/recall` | 本人 | **撤回**（仅发送者，2 分钟内）：正文清空、附件解除 |
| POST | `/api/dm/[id]/files` | 会话双方 | `multipart/form-data`：`file`（≤100MB）发送文件消息，存 `uploads/` |
| —— | 私信通知合并 | —— | 同一会话同一批未读只提醒一次：连发多条/文件会**更新**已有未读通知的标题（`人名+动作（N 条未读；文件：…按先后…）`）；通知已读后下一批重新开始 |
| GET | `/api/dm/files/[id]` | 会话双方 | 下载私聊文件（校验会话双方身份，中文文件名 RFC 5987 编码） |
| PUT | `/api/dm/[id]/read` | 会话双方 | 标记对方发来的未读消息为已读（幂等），返回 `{ updated }` |
| PUT | `/api/dm/[id]/hide` | 会话双方 | 隐藏会话（仅从我的列表移除，消息保留）；对方来新消息或我重新发起时自动恢复 |
| PUT | `/api/dm/[id]/settings` | 会话双方 | **个人设置**：`{ pinned?, muted? }` 置顶（排最前）/ 免打扰（不计入未读角标），仅影响本人 |
| DELETE | `/api/dm/[id]` | 会话双方 | 删除会话：清空双方全部消息与附件（级联），清理关联私信通知并尽力删除物理文件 |

消息对象含 `mine`（是否我发的）与 `readAt`（对方阅读时间，null 即未读，用于已读回执）。文件消息的 `attachment` 含 `{ id, name, size, mimeType }`，下载走 `GET /api/dm/files/{id}`。同一对用户只存一条会话（`user_a_id < user_b_id` 唯一约束）。

### 云文档（v5 新增，v6 增强）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/docs?projectId=` | 登录 | 我可访问的文档（含 `folder` 分组字段），按更新时间倒序 |
| POST | `/api/docs` | 项目成员 | `{ projectId, title, content?, folder? }` 新建；写入项目日志 |
| GET | `/api/docs/[id]` | 项目成员 | 文档全文（含 `canDelete`、创建者/更新者、分组） |
| PUT | `/api/docs/[id]` | 项目成员 | `{ title?, content?, folder? }` 保存；内容变化才快照（仅改分组不快照） |
| DELETE | `/api/docs/[id]` | 创建者/admin | 删除文档（级联删历史版本与评论），写入项目日志 |
| GET | `/api/docs/[id]/versions` | 项目成员 | 历史版本列表（新→旧，含全文与摘要） |
| POST | `/api/docs/[id]/versions` | 项目成员 | `{ versionId }` 恢复到指定版本；当前内容先快照，恢复可撤销 |
| GET | `/api/docs/[id]/comments` | 项目成员 | **文档评论**列表（时间正序，含 `quote` 引用片段与作者） |
| POST | `/api/docs/[id]/comments` | 项目成员 | `{ content, quote? }` 发表评论；通知文档创建者 + @提及的项目成员（`entityType=doc`，点击直达文档） |

正文为 Markdown 子集（标题带锚点/粗斜体/行内代码/代码块/列表/引用/分隔线/http(s) 链接/**`[[任务编号]]` 任务引用卡片**），渲染前整体 HTML 转义。任务详情接口返回 `referencedDocs`（引用了该任务的文档）。文档标题 ≤80 字，正文 ≤20 万字符，分组 ≤30 字。

### 项目日志 / 通知 / 标签

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/[id]/activities?limit=50` | 项目日志（谁在何时做了什么，中文句子） |
| GET | `/api/notifications` | 我的通知（倒序 50 条）+ `unreadCount` |
| PUT | `/api/notifications` | `{ ids: [...] }` 或 `{ all: true }` 标记已读 |
| GET/POST | `/api/teams/[id]/labels` | 团队标签列表 / 新建 `{ name, color? }` |
| PUT/DELETE | `/api/labels/[id]` | admin 改标签 / 删标签 |

## curl 示例

> 演示环境账号请使用强密码并妥善保管；生产环境严禁在文档/仓库中写入真实账号密码。

```bash
# 登录拿 Cookie（后续请求 -b 复用）——邮箱/密码替换为实际演示账号
curl -c jar.txt -X POST localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-demo-account@stu.edu.cn","password":"替换为该账号的实际强密码"}'

# 建任务（自动编号 AGI-0xx）
curl -b jar.txt -X POST localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"projectId":1,"title":"对接登录接口","priority":"high","assigneeId":4,"dueOn":"2026-10-08"}'

# 发聊天消息并 @ 人
curl -b jar.txt -X POST localhost:3000/api/projects/1/chat \
  -H "Content-Type: application/json" \
  -d '{"content":"@陈测试 今天下午联调","taskId":5}'

# 上传文件并挂到任务 5
curl -b jar.txt -X POST localhost:3000/api/projects/1/files \
  -F "file=@需求说明.pdf" -F "taskId=5"
```

## 数据模型（21 张表）

`users`、`sessions`（v1 原有）+ `teams`、`team_members`、`projects`、`project_members`、`project_stars`、`sprints`、`tasks`、`labels`、`task_labels`、`comments`、`chat_messages`、`chat_likes`、`activities`、`notifications`、`attachments`，以及 v5 新增的 `dm_conversations`、`dm_messages`、`docs`、`doc_versions`。字段定义见 `db/schema.ts`（含中文注释）。

## 已知边界（当前版本）

- 聊天与私聊均为轮询（建议前端 8 秒 `?afterId=` 增量），无 WebSocket 实时推送。
- 附件存服务器本地 `uploads/` 目录，重启不丢但随机器走，未接对象存储。
- 「待办」即 `GET /api/tasks?mine=1&status=todo,doing` 的视图，无独立表。
- 通知不含"临期/逾期"类型（需要定时任务，后续版本）。
- 云文档为「编辑锁靠最后写入胜出」：两人同时编辑同一篇时以后保存的为准（历史版本可找回先保存一方的内容）；无协同光标。
- 私聊未读回执只到「已读/未读」，无逐条已读列表；联系人范围限于同团队。
