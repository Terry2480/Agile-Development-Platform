---
name: agilecampus
description: 读写 AgileCampus 敏捷校园——查项目与任务、新建项目/任务/子任务、填写完成情况、改项目或归档、登记资源占用。当用户说"我有哪些项目""这个项目进度如何""列一下待办任务""给项目X加任务Y""在任务Z下面加个子任务""把任务Z标记完成，情况是…""归档某项目""登记我占用了 GPU-01 三小时"时触发。需事先配置 AGILECAMPUS_URL 与 AGILECAMPUS_TOKEN。
---

# AgileCampus 读写

通过 Personal API Token 以用户身份读写 AgileCampus。所有请求走 `/api/agent/*`，携 `Authorization: Bearer <token>`。

## 前置配置

需要两个环境变量（用户在网页「设置 → 个人访问令牌」生成令牌）：

- `AGILECAMPUS_URL`：站点地址，如 `http://localhost:3000`
- `AGILECAMPUS_TOKEN`：令牌明文

**若两者任一缺失**，先停下，引导用户：①登录 AgileCampus →「设置 → 个人访问令牌」生成令牌（明文只显一次）；②把令牌与站点地址配置为上述环境变量（如写入 shell profile 或 `.env`）。配齐后再继续。

## 先读后写：自己查 id，别问用户要 uuid

用户只会给名字（「赤壁演习那个项目」）。**先调读端点自行查得 uuid**，不要让用户去地址栏抄。

### 列我的项目（拿 projectId / teamId）

```bash
curl -sS "$AGILECAMPUS_URL/api/agent/projects" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"projects":[{"id":"...","name":"赤壁演习","status":"active","teamId":"...",
#     "teamName":"东吴实验室","taskTotal":12,"doneCount":5}]}
```

按 `name` 匹配即得 `id`；同名多个则列出让用户选。

### 项目详情（进度、里程碑）

```bash
curl -sS "$AGILECAMPUS_URL/api/agent/projects/<projectId>" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
# → {"name":"赤壁演习","myRole":"admin","taskTotal":12,"byStatus":{"todo":5,"doing":2,"done":5},
#     "milestones":[{"id":"...","title":"中期答辩","targetDate":"2026-09-01"}]}
```

### 列任务（拿 taskId）

可选参数：`status`（`todo`/`doing`/`done`）、`assigneeId`、`dueBefore`（`YYYY-MM-DD`）。

```bash
curl -sS "$AGILECAMPUS_URL/api/agent/projects/<projectId>/tasks?status=todo" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
```

### 任务详情 / 子任务清单

```bash
curl -sS "$AGILECAMPUS_URL/api/agent/tasks/<taskId>" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
curl -sS "$AGILECAMPUS_URL/api/agent/tasks/<taskId>/subtasks" -H "Authorization: Bearer $AGILECAMPUS_TOKEN"
```

## 写入

用 `curl` 调用，读取环境变量，勿把令牌明文写进任何文件或回显。

### 新建项目

需要 `teamId`（从上面列项目的响应里取）与 `name`。**须为该团队 admin**，否则 403。

```bash
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/projects" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<uuid>","name":"<项目名>","startDate":"2026-09-01"}'
```

### 改项目 / 归档

至少给一个字段：`name`、`description`、`startDate`、`endDate`、`status`（`active`/`archived`）。须为 admin。

```bash
curl -sS -X PATCH "$AGILECAMPUS_URL/api/agent/projects/<projectId>" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"archived"}'
```

### 在任务下加子任务

所属项目由父任务推得，**无须传 projectId**。父任务删除时子任务级联删除。

```bash
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/tasks/<taskId>/subtasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"<子任务标题>","priority":"medium"}'
```

### 添加任务

需要 `projectId`（uuid）与 `title`。可选 `description`、`assigneeId`、`startDate`、`dueDate`（`YYYY-MM-DD`）、`milestoneId`、`priority`（`low`/`medium`/`high`）。

```bash
# 推荐：projectId 走路径
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/projects/<projectId>/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"<标题>","priority":"medium"}'

# 旧约（等效）：projectId 走 body
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<uuid>","title":"<标题>","priority":"medium"}'
```

### 填写完成情况（标记完成）

需要 `taskId`（uuid）与 `completionNote`（完成说明）。会把任务置为 `done`。

```bash
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/tasks/complete" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid>","completionNote":"<完成说明>"}'
```

### 登记资源占用

需要 `teamId`（uuid）、`resourceName`、`startTime`（ISO 8601）。可选 `purpose`、`endTime`（省略 = 占用中）。

```bash
curl -sS -X POST "$AGILECAMPUS_URL/api/agent/resource-usage" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<uuid>","resourceName":"GPU-01","purpose":"训练模型","startTime":"2026-07-22T14:00:00Z"}'
```

## 要点

- **需要 uuid 而用户只给了名字**（如项目名、任务标题）时，**先调读端点自查**：`GET /api/agent/projects` 得项目与团队 id，`GET /api/agent/projects/<id>/tasks` 得任务 id。名字对不上或同名多个才回问用户。**绝不臆造 uuid**。
- **解读响应状态**：`200` 成功；`400` 参数错；`401` 令牌无效/缺失/已撤销（提示重新配置或重新生成）；`403` 越权（该令牌主人对目标项目/团队无权限）；`500` 可重试。
- **绝不回显或落盘令牌明文**。
- 完整契约见项目内 `docs/agent-api.md`。
