# 第四版发布清单

准备日期：2026-10-14（Asia/Hong_Kong）。本文用于本次从本地最新版升级现有服务器；文档准备完成不代表代码已推送、服务器已迁移或已上线。

实际配置：项目 `/var/www/agile-platform`，分支 `terry/workplace`，应用用户 `agile`，systemd 服务 `agile-platform`，PostgreSQL 16 的 `5433` 端口与 `agilecampus` 库，访问地址 `https://39.96.70.129`。完整备份及恢复步骤见 [服务器交接手册](server-handoff.md)。

## 本次发布内容

| 功能 | 数据库要求 |
| --- | --- |
| 里程碑成果区：上传、关联已有文件、外部链接、移除关联 | 新增 `milestone_resources`，须在里程碑表之后创建 |
| 任务检查清单，详情与展开卡片同步 | `task_checklist_items` |
| 多人协作、负责人自动参与、参与者待办与分配通知 | `task_collaborators`，回填已有负责人 |
| 一次性截止提醒、删除已读通知 | `task_deadline_reminders`；常驻服务负责调度，无需另建定时任务 |
| 通知点击跳转、任务详情、筛选与三列看板 | 更新代码、构建、重启，无额外迁移 |
| 文件库自动更新 | 当前页面每 20 秒检查其他成员上传/撤回，切回页面也检查；无额外迁移 |
| 多标签、课程字段、教学周、聊天时区等此前改动 | 核对服务器状态；缺失时补迁移，聊天转换须先确认历史时区 |

成果上传仍使用项目文件库与 100MB 单文件上限；移除成果、删除里程碑只删除关联，文件仍保留。项目文件被撤回后，对应成果关联自动移除。普通成员可添加成果、移除自己添加的成果，创建者和管理员可管理全部成果。

## 1. 本地准备

在本地项目目录运行：

```powershell
git status --short
git branch --show-current
npx tsc --noEmit
npm run lint
```

关闭本地开发服务后执行 `npm run build`，避免开发与生产构建共用 `.next`。构建成功后可重新启动开发服务。相关数据库回滚测试可执行：

```powershell
node --test tests/milestone-resources.test.mjs tests/file-consistency.test.mjs
```

测试连接本地 `.env.local` 中的数据库，不在生产数据库运行测试。类型检查和成果区相关三项测试已在准备时通过；本次生产构建和线上验收仍须执行。

检查差异，只提交本次需要发布的代码、数据库脚本、测试和文档；不提交 `.env.local`、uploads、数据库备份。提交并推送至 `origin/terry/workplace` 后记录完整提交号。未提交、未推送的代码不会上线；不要用工作区截图代替提交号核对。

## 2. 服务器预检与维护窗口

root 先确认服务和数据库：

```bash
systemctl status agile-platform --no-pager -l
pg_lsclusters
df -h /var/www/agile-platform /var/backups
/usr/bin/node -v
/snap/bin/certbot certificates
```

agile 在项目目录确认工作区、旧提交和目标提交：

```bash
cd /var/www/agile-platform
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin terry/workplace
git rev-parse origin/terry/workplace
git diff --stat HEAD..origin/terry/workplace
```

工作区须干净，目标提交与本地推送提交一致。将旧提交、目标提交和备份目录记录在仓库之外；不要在核验过程中打印环境文件或密码。

采用单目录构建，会短暂停机。root 按交接手册第 7 节停止服务，确认 3000 无监听，并备份数据库、uploads、环境文件及旧提交。确认备份命令全部成功后才能更新；数据库服务保持运行。历史备份不能替代本次新备份。

## 3. 更新代码和数据库

以下由 agile 执行，每条成功才继续：

```bash
cd /var/www/agile-platform
git pull --ff-only origin terry/workplace
git rev-parse HEAD
npm ci --include=dev
```

保留服务器 `.env.local` 和 uploads。下面是已有数据库的增量迁移顺序；这些脚本可重复执行，已完成的可保留。迁移失败立即停止，不继续构建或启动。不要使用 `db:seed` 重置业务数据，也不要用 `db:push` 代替升级步骤。

```bash
npm run db:add-member-duty
npm run db:add-member-duties
npm run db:add-project-course
npm run db:add-milestones
npm run db:add-team-invites
npm run db:add-auth-protection
npm run db:add-file-cleanup
npm run db:add-task-checklist
npm run db:add-task-collaborators
npm run db:add-deadline-reminders
npm run db:add-milestone-resources
npm run db:fix-chat-timezone -- --check
```

成果区依赖 `milestones` 和 `attachments`，因此必须先完成里程碑迁移。聊天检查为 `timestamp with time zone` 时不用再转换；若为无时区类型，按 [聊天时区修复](chat-timezone.md) 核对历史数据后执行对应转换，不猜测、不盲目重复转换。

root 可执行下列只读结构确认，不需要展示数据库密码：

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus
```

进入查询窗口后运行 [部署文档“数据库只读确认”](deployment.md#数据库只读确认) 的查询：六项 ready 均为 true，附件清理触发器启用，课程、教学周、多标签及聊天时间字段齐全。完成后输入 `\q` 退出。表存在只是结构初检，还需要上线后实际读写验证。

## 4. 构建、启动

agile：

```bash
cd /var/www/agile-platform
npm run build
```

构建失败保持停服，保留错误并排查。构建成功后 root：

```bash
systemctl start agile-platform
systemctl status agile-platform --no-pager -l
curl -I http://127.0.0.1:3000
curl -I https://39.96.70.129
journalctl -u agile-platform -n 80 --no-pager
```

服务应 running，页面返回 200 或预期跳转，日志无缺表、缺列或持续异常。仅代码更新无需重启数据库或 Nginx。若确需修改代理配置，先 `nginx -t` 再 reload。原有 Nginx 105m 和 Next.js 105mb 请求限制继续适用，不另启动 PM2 或开发服务器。

## 5. 浏览器验收

使用 HTTPS 和两个测试账号，刷新页面后按下表验证；只操作临时任务、里程碑和文件。

| 场景 | 通过标准 |
| --- | --- |
| 登录与旧数据 | 登录、刷新、退出正常，原项目、成员、任务、附件保留 |
| 成果上传 | 新文件同时出现在成果区和项目文件库，刷新后仍可下载 |
| 文件关联与链接 | 已有项目文件可关联多个里程碑；http/https 链接可打开，非法链接被拒绝 |
| 成果权限 | 普通成员可提交、移除自己的成果，不能移除他人成果；创建者/管理员可管理全部 |
| 文件保留 | 移除成果或删除测试里程碑后，文件仍可从项目文件库下载 |
| 文件撤回 | 从项目文件库撤回测试文件后，所有相关成果关联消失，下载不可用 |
| 文件库同步 | 两个账号打开同一项目，一方上传/撤回后，另一方文件库约 20 秒后更新；切回页面立即检查，不需刷新整页 |
| 大文件 | 大于 25MB、小于 100MB 的测试文件上传下载成功；超过 100MB 在上传前被拒绝 |
| 任务与检查清单 | 多人待办正确，清单可读写，详情与展开卡片同步，刷新保留 |
| 筛选和看板 | 筛选结果一致，状态菜单移动任务后同步列表、待办与进度 |
| 通知 | 点击跨项目任务通知打开正确任务；删除已读保留未读；明天截止的未完成任务向参与者各提醒一次 |
| 提醒去重 | 多轮检查、删除提醒、重启服务后同一截止日期不重复提醒；该项用测试数据和计划内重启验收 |
| 课程与团队 | 教学周日期、多标签、在线状态、聊天日期时间正常；创建迭代仍只允许负责人 |

邀请码申请若返回 429，表示同一账号 10 分钟内超过 10 次提交；失败也计数。按响应 `retryAfter` 等待，不连续提交；负责人检查已有待审核申请。此限流无需新配置或新迁移。

完整验收说明见 [部署文档](deployment.md#上线验收)。首页可访问不等于业务验证通过。

## 6. 异常与回退

- 成果区 500：先查应用日志，确认 `milestone_resources` 已在服务器应用数据库创建，运行的是本次构建。
- 502：检查 systemd 服务、构建是否成功和内部 3000 监听；不要先重启数据库。
- 上传 413 或表单解析失败：确认 100MB 文件限制、105MB 代理限制、上传超时及磁盘空间。
- 数据库迁移或构建失败：保持停服，不跳过失败步骤直接启动。

回退按交接手册第 10 节：停止应用、保留当前数据及日志，确认数据库兼容旧提交后切换到本次记录的旧提交，重新安装依赖、构建、启动并验收。本次新增关联表通常可保留，但若进行了聊天时区转换，必须单独确认旧代码兼容。不要仅为回退代码自动恢复数据库；恢复会影响备份后的新数据，附件也须配套处理。

上线后在仓库外记录实际部署时间、旧/新提交号、备份路径、迁移结果和验收结果，再更新交接状态；在确认前不把第四版标为“已上线”。
