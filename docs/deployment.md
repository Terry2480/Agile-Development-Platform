# 服务器部署与版本升级

本文适用于 Linux、PostgreSQL、常驻 Node.js 服务和 Nginx。示例路径 `/srv/agilecampus`、服务名 `agilecampus` 按服务器实际值替换。已有 PM2 服务可沿用，不需再创建 systemd 服务。

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

以下脚本可重复执行，不清空已有业务数据。逐条执行，任一步失败都先停止检查：

```bash
npm run db:add-member-duty
npm run db:add-milestones
npm run db:add-team-invites
npm run db:add-auth-protection
npm run db:add-file-cleanup
npm run db:add-project-course
```

| 脚本 | 更新内容 |
| --- | --- |
| db:add-member-duty | 成员分工字段 |
| db:add-milestones | 里程碑及关联任务表、开学日期、教学周和星期字段 |
| db:add-team-invites | 团队邀请码与加入申请 |
| db:add-auth-protection | 登录限流表 |
| db:add-file-cleanup | 清理队列、清理函数及附件删除触发器 |
| db:add-project-course | 项目课程名称字段 |

旧版本执行过 db:add-milestones 也要再执行，才能添加教学周字段。触发器不是 db:push 自动创建的内容，必须运行 db:add-file-cleanup。

本版聊天时间还需按 [聊天时区修复](chat-timezone.md) 检查并迁移；旧数据时区需要确认，不能直接使用 db:push 自动转换该字段。

已有数据库升级使用上述增量脚本，不直接运行 db:push 或 db:seed。全新空数据库先运行 npm run db:push 建基础表，再运行上述脚本，确保触发器也存在。

```bash
npm run build
sudo systemctl start agilecampus
sudo systemctl status agilecampus --no-pager
```

构建失败时不要启动不完整的新版本。回退代码时恢复旧提交并重新构建；本版增量字段可保留。恢复数据库不能恢复磁盘附件，必须与文件备份配套处理。

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
```

ready 均为 true；触发器有一行且 tgenabled 为 O 或 A；字段查询返回四行。

## 上线验收

使用实际 HTTPS 地址验证登录、刷新后保留登录、退出、创建课程项目、教学周里程碑、任务状态修改、评论、聊天、邀请码和日夜切换。

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
| 清理持续失败 | uploads 权限；file_cleanup 的 attempts、last_error |

查看应用日志：journalctl -u agilecampus -n 100 --no-pager。Nginx 日志路径按实际配置查看。持续备份数据库与附件，并定期验证恢复。
