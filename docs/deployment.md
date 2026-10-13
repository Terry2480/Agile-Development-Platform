# 服务器部署与版本升级

> 接手当前阿里云服务器时，先读 [实际服务器部署交接](server-handoff.md)。实际项目目录为 `/var/www/agile-platform`，服务名为 `agile-platform`，项目 PostgreSQL 16 端口为 **5433**；下文通用示例不能原样照搬。

本文适用于 Linux、PostgreSQL、常驻 Node.js 服务和 Nginx。示例路径 `/srv/agilecampus`、服务名 `agilecampus` 按服务器实际值替换。已有 PM2 服务可沿用，不需再创建 systemd 服务。

## 本次版本更新

| 内容 | 部署操作 |
| --- | --- |
| 成员多分工标签 | 启动新版前运行 `npm run db:add-member-duties`，原单标签会保留 |
| 仅负责人可创建迭代 | 更新代码、构建并重启；支持多标签中的“负责人（组长）”，创建者默认拥有权限 |
| 个人设置页与主界面主题统一 | 更新代码、构建并重启，浏览器刷新后验证日间和夜间模式 |
| 成员在线状态时区修复 | 更新代码、构建并重启，不需修改会话表结构 |
| 聊天时间与日期分组修复 | 先检查服务器聊天时间字段；尚未转换时，确认历史时区后运行独立迁移 |

本次收紧的是**创建迭代**权限，未同时收紧编辑、启动、完成已有迭代的后端权限。管理员如果没有负责人标签，也不能创建迭代。

## 部署前确认

- 代码已提交并推送到服务器使用的分支，当前开发分支为 `terry/workplace`。尚未推送的本地修改不能通过服务器 git pull 获取。
- Next.js 最低要求 Node.js 20.9；使用 `node --version` 确认。数据库脚本和构建需要开发依赖，安装时不省略它们。
- 对外地址使用 HTTPS，证书受浏览器信任且匹配实际访问地址。IP 访问也需要匹配 IP 的证书，本文不包含证书签发流程。
- 当前生产代码拒绝 HTTP 可信地址，登录 Cookie 带 Secure。仍使用 `http://IP` 时先解决 HTTPS，再使用新版登录；不要用开发服务器绕过生产保护。
- 数据库与 uploads 均有备份，应用用户有上传目录读、写、删除权限。
- Node 3000 和数据库 5432 不开放给公网。仓库 docker-compose.yml 使用开发密码及端口映射，不应原样用于公网生产环境。

## 环境配置

服务器项目根目录的 `.env.local`：

```dotenv
DATABASE_URL=postgres://数据库用户:密码@127.0.0.1:5432/数据库名
AUTH_ALLOWED_ORIGINS=https://实际访问地址
TRUST_PROXY_IP=true
```

不要复制本地数据库连接；密码中的特殊字符需 URL 编码。可信地址包含协议和实际端口，不含路径或末尾斜杠，多个地址用逗号分隔。配置文件不提交 Git，限制为服务用户可读。

只有 Nginx 覆盖 X-Real-IP 且应用端口不能公网直连时才启用 TRUST_PROXY_IP；否则设为 false，此时多个用户会共享来源限流桶。

## 升级已有版本

安排维护窗口，停止应用后成套备份数据库和 uploads，数据库服务不用停止。数据库可用 `pg_dump -Fc` 导出，附件用 tar 打包；备份放在项目目录之外，并确认可读取。记录旧提交号以便回退。

```bash
cd /srv/agilecampus
git rev-parse HEAD
sudo systemctl stop agilecampus
# 此处完成数据库及 uploads 备份
git status --short
git pull --ff-only origin terry/workplace
npm ci --include=dev
```

存在服务器本地改动或拉取失败时先解决问题，不强制重置覆盖文件。环境文件和 uploads 必须保留。

本地提交后还需要推送到远程，服务器才能拉取。本地与服务器分别执行 `git rev-parse HEAD`，确认部署的是同一提交；不要仅凭页面外观判断是否更新成功。

以下脚本可重复执行，不清空已有业务数据。逐条执行，任一步失败都先停止检查：

```bash
npm run db:add-member-duty
npm run db:add-member-duties
npm run db:add-milestones
npm run db:add-team-invites
npm run db:add-auth-protection
npm run db:add-file-cleanup
npm run db:add-project-course
```

| 脚本 | 更新内容 |
| --- | --- |
| db:add-member-duty | 成员分工字段 |
| db:add-member-duties | 成员多标签字段，保留原有分工；新版启动前必须执行 |
| db:add-milestones | 里程碑及关联任务表、开学日期、教学周和星期字段 |
| db:add-team-invites | 团队邀请码与加入申请 |
| db:add-auth-protection | 登录限流表 |
| db:add-file-cleanup | 清理队列、清理函数及附件删除触发器 |
| db:add-project-course | 项目课程名称字段 |

旧版本执行过 db:add-milestones 也要再执行，才能添加教学周字段。触发器不是 db:push 自动创建的内容，必须运行 db:add-file-cleanup。

启动新版前检查聊天时间字段：

```bash
npm run db:fix-chat-timezone -- --check
```

输出为 `timestamp with time zone` 时无需再次转换。输出为 `timestamp without time zone` 时，按 [聊天时区修复](chat-timezone.md) 核对已知消息的原始时间，确认保存的是 UTC 还是北京时间，再选择对应命令迁移。未确认历史时区时先不要启动新版；不要直接使用 `db:push` 自动转换该字段。

本地已执行过的数据库更新不会随着 Git 提交同步到服务器。服务器仍需连接自己的数据库执行多标签更新和聊天字段检查。

已有数据库升级使用上述增量脚本，不直接运行 db:push 或 db:seed。全新空数据库先运行 npm run db:push 建基础表，再运行上述脚本，确保触发器也存在。

```bash
npm run build
sudo systemctl start agilecampus
sudo systemctl status agilecampus --no-pager
```

构建失败时不要启动不完整的新版本。回退代码时恢复旧提交并重新构建；本版增量字段可保留。恢复数据库不能恢复磁盘附件，必须与文件备份配套处理。

若使用 PM2，停服、启动与日志查看沿用原进程名。例如应用进程确实叫 `agilecampus` 时，使用 `pm2 stop agilecampus`，构建成功后 `pm2 restart agilecampus --update-env`，再执行 `pm2 status` 和 `pm2 logs agilecampus --lines 100`；不要同时启动 systemd 和 PM2 两套应用进程。

聊天时间迁移改变了字段类型，回退到迁移前的旧代码时不能只回退代码就认定兼容。先验证旧代码读取带时区时间的行为；若需恢复数据库，应在维护窗口按备份方案处理，不直接把聊天时间字段改回无时区类型试错。

## Nginx 上传与代理

把以下指令合并到现有、已配置证书的 HTTPS server 块，保留原证书配置：

```nginx
client_max_body_size 105m;
client_body_timeout 300s;

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 30s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
}
```

应用单文件上限 100MB，Next.js 代理及 Nginx 上限 105MB，为表单留空间。其他 CDN、负载均衡也必须允许此大小。Nginx 大请求临时目录需要足够空间与权限。应用目前在内存解析文件，并发大文件上传时需观察内存占用。

```bash
sudo nginx -t
sudo systemctl reload nginx
```

仅在配置测试通过后重新加载。

## 常驻进程与文件持久化

生产使用 npm run build 后运行 `npm run start -- --hostname 127.0.0.1`。已有进程管理方式可继续使用，以下为 systemd 示例：

```ini
[Unit]
Description=AgileCampus
After=network.target

[Service]
Type=simple
User=agilecampus
WorkingDirectory=/srv/agilecampus
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

User 必须是已存在用户，npm 路径按 command -v npm 修改。用户级安装的 Node 还需为服务配置正确 PATH。首次安装服务执行 systemctl daemon-reload 和 systemctl enable agilecampus；已有服务不要重复另建进程。

WorkingDirectory 决定 uploads 位置，应用用户需要读写和删除权限，不使用 chmod 777。拉取、构建、切换版本时保留 uploads；容器需持久卷，多实例需共享上传目录。后台清理在启动时及每分钟执行，需常驻 Node.js 服务。

## 数据库只读确认

在 PostgreSQL 查询窗口或 psql 中运行，确保连接的是服务器应用的同一个数据库：

```sql
SELECT to_regclass('auth_rate_limits') IS NOT NULL AS auth_ready,
       to_regclass('file_cleanup') IS NOT NULL AS cleanup_ready;

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = to_regclass('attachments')
  AND tgname = 'attachments_file_cleanup' AND NOT tgisinternal;

SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ((table_name = 'projects' AND column_name = 'course_name')
    OR (table_name = 'milestones' AND column_name IN
        ('semester_starts_on', 'teaching_week', 'teaching_weekday')));

SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ((table_name = 'team_members' AND column_name = 'duties')
    OR (table_name = 'chat_messages' AND column_name = 'created_at'));
```

ready 均为 true；触发器有一行且 tgenabled 为 O 或 A；课程与教学周字段查询返回四行。最后一条查询返回两行：`team_members.duties` 的 data_type 为 `ARRAY`、udt_name 为 `_text`，`chat_messages.created_at` 的 data_type 为 `timestamp with time zone`。

## 上线验收

使用实际 HTTPS 地址验证登录、刷新后保留登录、退出、创建课程项目、教学周里程碑、任务状态修改、评论、聊天、邀请码和日夜切换。

本次重点验收：

1. 团队创建者给成员同时分配“开发者”“展示人”和一个自定义标签，保存、刷新、重新登录后标签仍完整；升级前的原分工仍保留。
2. 普通成员和仅有管理员角色的账号看不到创建迭代入口，直接提交创建请求应返回 403；创建者和拥有负责人标签的成员可以创建，负责人标签不必位于标签列表第一项。
3. 创建者移除另一个成员的负责人标签后，该成员再次创建迭代应被拒绝。被拒绝的请求不应创建记录或停用原迭代。
4. 日间从主界面进入个人设置页，应保持米黄色和橙色；夜间应保持深色和蓝色。输入框边界、文字、按钮与主界面一致，资料保存仍可正常使用。
5. 核对一条已知历史聊天消息和一条新消息的实际发送时间，日期和时间均应正确，接近午夜的消息也应归入正确日期。

使用两个账号检查团队页和项目页的在线状态：登录后应在线，持续使用时保持在线；退出所有设备后，在另一账号的下一次刷新中显示离线。关闭页面但未退出时，最后一次请求超过 5 分钟后显示离线，后台标签页仍有请求时可能保持在线。在线表示最近有有效会话活动，不是实时连接状态。

会话过期时间与活跃时间按 UTC 保存，代码显式使用 UTC 数据库时钟判断，兼容数据库使用 UTC 或北京时间。此在线状态修复不需要数据库迁移，更新代码后重新构建、重启即可；聊天时间修复仍需按照前文的独立步骤处理。

上传超过 25MB、低于 100MB 的测试文件，下载核对内容；超过 100MB 文件应在上传前被拒绝。使用两个账号验证成员只能撤回自己的文件，负责人或管理员可撤回团队文件。撤回后不能下载，并检查磁盘清理。不要删除真实交付材料做测试。

| 故障 | 检查位置 |
| --- | --- |
| POST 503 | AUTH_ALLOWED_ORIGINS 未配置或不是有效 HTTPS 来源 |
| POST 403 | 页面来源是否匹配配置、成员权限是否足够 |
| 登录后仍未登录 | HTTP 访问导致 Secure Cookie 被拒绝 |
| 上传 413 | 单文件超限，或 Nginx、其他代理限制过低 |
| 表单解析失败 | 请求被截断；新版配置是否已构建、重启 |
| 缺少表或字段 | 更新脚本是否在正确数据库执行 |
| 报错缺少 team_members.duties | 在服务器执行 db:add-member-duties，随后重启新版 |
| 负责人创建迭代被拒绝 | 是否有完整的“负责人（组长）”标签；仅管理员角色不授予创建权限 |
| 所有成员仍能创建迭代 | 提交号是否匹配，服务是否仍运行旧构建，是否有重复应用进程 |
| 聊天时间或日期仍错误 | 聊天字段类型、迁移选择的历史时区、已知消息原始时间 |
| 清理持续失败 | uploads 权限；file_cleanup 的 attempts、last_error |

查看应用日志：journalctl -u agilecampus -n 100 --no-pager。Nginx 日志路径按实际配置查看。持续备份数据库与附件，并定期验证恢复。
