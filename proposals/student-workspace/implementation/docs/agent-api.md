# Agent 写入 API（供 Claude Code 等外部程序调用）

这些端点让浏览器之外的程序以你的身份写入 AgileCampus——添加任务、填写完成情况、登记资源占用。

## 认证

所有 `/api/agent/*` 端点用 **Personal API Token** 认证（非浏览器 session）：

```
Authorization: Bearer <token>
```

在网页「设置 → 个人访问令牌」生成令牌，明文只显示一次。令牌权限等同于你本人：只能操作你有权限的团队/项目，越权返回 `403`。

约定两个环境变量：

- `AGILECAMPUS_URL`：本站地址，如 `http://localhost:3000`
- `AGILECAMPUS_TOKEN`：上面生成的令牌明文

## 端点

### 1. 新建任务 — `POST /api/agent/tasks`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectId` | uuid | 是 | 目标项目 |
| `title` | string | 是 | 任务标题 |
| `description` | string | 否 | 描述 |
| `assigneeId` | uuid | 否 | 负责人（须为团队成员） |
| `startDate` | string | 否 | 起始日 `YYYY-MM-DD`（供时间线排期） |
| `dueDate` | string | 否 | 截止日 `YYYY-MM-DD` |
| `milestoneId` | uuid | 否 | 里程碑（须属该项目） |
| `priority` | `low`\|`medium`\|`high` | 否 | 默认 `medium` |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"...","title":"撰写调研问卷","priority":"high"}'
```

### 2. 填写完成情况 — `POST /api/agent/tasks/complete`

将任务标记为 `done` 并附完成说明。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | uuid | 是 | 目标任务 |
| `completionNote` | string | 是 | 完成说明 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks/complete" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"...","completionNote":"已跑通全部演武，79 战皆捷"}'
```

### 3. 登记资源占用 — `POST /api/agent/resource-usage`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `teamId` | uuid | 是 | 目标团队 |
| `resourceName` | string | 是 | 资源名，如 `GPU-01` |
| `purpose` | string | 否 | 用途 |
| `startTime` | ISO 8601 | 是 | 开始时间，如 `2026-07-22T14:00:00Z` |
| `endTime` | ISO 8601 | 否 | 结束时间；省略 = 占用中 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/resource-usage" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"...","resourceName":"GPU-01","purpose":"训练模型","startTime":"2026-07-22T14:00:00Z"}'
```

### 4. 列我的项目 — `GET /api/agent/projects`

返回令牌主人参与的全部项目（跨团队）及任务统计。无参数。

```bash
curl "$AGILECAMPUS_URL/api/agent/projects" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"projects":[{"id":"...","name":"赤壁演习","status":"active","teamId":"...",
#     "teamName":"东吴实验室","taskTotal":12,"doneCount":5}]}
```

### 5. 新建项目 — `POST /api/agent/projects`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `teamId` | uuid | 是 | 目标团队（令牌主人须为该团队 admin） |
| `name` | string | 是 | 项目名 |
| `description` | string | 否 | 描述 |
| `startDate` / `endDate` | string | 否 | `YYYY-MM-DD` |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/projects" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"teamId":"...","name":"夷陵之役","startDate":"2026-09-01"}'
```

### 6. 项目详情 — `GET /api/agent/projects/{projectId}`

返回项目本体 + 里程碑清单 + 任务状态计数。

```bash
curl "$AGILECAMPUS_URL/api/agent/projects/$PID" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"id":"...","name":"赤壁演习","status":"active","myRole":"admin","taskTotal":12,
#     "byStatus":{"todo":5,"doing":2,"done":5},
#     "milestones":[{"id":"...","title":"中期答辩","status":"open","targetDate":"2026-09-01"}]}
```

### 7. 改项目 / 归档 — `PATCH /api/agent/projects/{projectId}`

仅团队 admin 可动。至少提供一个字段；传 `null` 表示清空该字段。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 项目名 |
| `description` | string \| null | 描述 |
| `startDate` / `endDate` | string \| null | `YYYY-MM-DD` |
| `status` | `active`\|`archived` | 归档用 `archived` |

```bash
curl -X PATCH "$AGILECAMPUS_URL/api/agent/projects/$PID" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"archived"}'
```

### 8. 列项目下的任务 — `GET /api/agent/projects/{projectId}/tasks`

可选查询参数：`status`（`todo`/`doing`/`done`）、`assigneeId`（uuid）、`dueBefore`（`YYYY-MM-DD`，含当日）。

```bash
curl "$AGILECAMPUS_URL/api/agent/projects/$PID/tasks?status=todo" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"tasks":[{"id":"...","title":"撰写问卷","status":"todo","priority":"high",
#     "dueDate":"2026-09-01","assigneeName":"周瑜","parentTaskId":null, ...}]}
```

### 9. 在项目下建任务 — `POST /api/agent/projects/{projectId}/tasks`

字段同端点 1，但 `projectId` 取自路径而非 body。端点 1（`POST /api/agent/tasks`）为旧约，仍可用。

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/projects/$PID/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"撰写调研问卷","priority":"high"}'
```

### 10. 任务详情 — `GET /api/agent/tasks/{taskId}`

```bash
curl "$AGILECAMPUS_URL/api/agent/tasks/$TID" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"id":"...","projectId":"...","title":"调研现有方案","status":"doing","priority":"medium",
#     "startDate":null,"dueDate":"2026-09-01","milestoneId":"...","parentTaskId":null,
#     "assigneeId":"...","assigneeName":"周瑜","completionNote":null,
#     "createdAt":"2026-07-25T09:42:20.351Z","updatedAt":"2026-07-25T09:42:20.351Z"}
```

### 11. 在任务下建子任务 — `POST /api/agent/tasks/{taskId}/subtasks`

字段同端点 9。所属项目由父任务推得，**无须传 `projectId`**；父任务删除时子任务级联删除。

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks/$TID/subtasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"子任务：设计接口","priority":"high"}'
# → {"id":"...","title":"子任务：设计接口","status":"todo","parentTaskId":"...","projectId":"..."}
```

### 12. 列任务的子任务 — `GET /api/agent/tasks/{taskId}/subtasks`

只列**直接子级**，不递归取孙级。

```bash
curl "$AGILECAMPUS_URL/api/agent/tasks/$TID/subtasks" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"parentTaskId":"...","subtasks":[{"id":"...","title":"子任务：设计接口","status":"todo", ...}]}
```

## 响应与错误

- `200`：成功，返回创建/更新后的精简对象（含 `id`）。
- `400`：请求格式无效（缺字段、类型错、时间非法）。
- `401`：令牌缺失、畸形、伪造或已撤销。
- `403`：越权——令牌主人对目标项目/团队无权限。
- `500`：服务器错误，可重试。

## 安全说明

- 令牌库中只存 sha256 hash，明文只在生成时返回一次。
- 外部写入一律不被信任：`token → userId → lib 权限校验`，越权由业务层拒绝。
- 令牌泄露即在设置页撤销，立即失效。

## 定时提醒（cron）

`POST /api/cron/reminders` 由外部调度每日打一次，扫临期/逾期任务并飞书私信负责人。以 `CRON_SECRET` 鉴权：

    curl -X POST "$AGILECAMPUS_URL/api/cron/reminders" -H "Authorization: Bearer $CRON_SECRET"

NAS 部署可用 host crontab（每日 09:00）：

    0 9 * * * curl -fsS -X POST "http://localhost:3000/api/cron/reminders" -H "Authorization: Bearer <CRON_SECRET>" >/dev/null 2>&1
