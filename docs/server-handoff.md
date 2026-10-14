# 实际服务器部署交接与发布手册

本文记录本项目实际使用的部署方式，供新会话或维护者在没有聊天上下文时接手。记录日期：2026-10-13（Asia/Hong_Kong）。这是历史已确认状态，不是实时监控；操作前必须在服务器重新检查。

## 1. 接手者先读

- **生产使用 systemd + Node.js + Nginx + PostgreSQL，未使用 PM2，也未用 Docker 运行服务器网站或数据库。** Docker Desktop 只用于电脑上的开发数据库。不要另外启动 PM2、Docker 或第二个 Next.js 实例。
- 用户已确认第二版部署成功。后续本地改动不代表线上已更新，必须检查服务器提交号。
- 先阅读本文，再阅读 `docs/deployment.md` 中当前版本的迁移要求；后者的 `/srv/agilecampus`、服务名 `agilecampus`、端口 `5432` 是通用示例，不能照搬到本服务器。
- 不读取或展示密码、私钥、Cookie。`.env.local`、数据库和附件不通过 Git 同步。
- 不强制重置服务器工作区，不删除现有数据库或附件，不把旧的本地备份重新覆盖到线上。
- 本文发布命令会短暂停机；逐条执行，任何一步失败先停止后续步骤，保留错误与恢复所需信息。

## 2. 已确认的实际配置

| 项目 | 实际值 |
| --- | --- |
| 服务商 / 地域 | 阿里云 ECS / 北京 |
| 公网 IP / 测试地址 | `39.96.70.129` / `https://39.96.70.129` |
| 系统 / 配置 | Ubuntu 22.04，2 vCPU、4GiB 内存、60GiB 系统盘，3Mbps 公网带宽 |
| 项目路径 | `/var/www/agile-platform` |
| 仓库 | `https://github.com/Terry2480/Agile-Development-Platform.git` |
| 部署分支 | `terry/workplace`；`terry/space` 不存在，不要使用 |
| 系统管理用户 / 应用用户 | `root` / `agile` |
| Node.js / npm | 安装时确认 Node.js 24.21.0、npm 11.19.0，来自 NodeSource；接手时重新查版本 |
| 网站服务 / 内部地址 | `agile-platform.service` / `127.0.0.1:3000` |
| PostgreSQL 16 | `16/main`，端口 **5433**，项目库 `agilecampus`，项目数据库账号 `agile_app` |
| PostgreSQL 14 | 原安装的 `14/main`，端口 5432；不是项目目标库，不擅自删除 |
| 环境文件 / 附件 | 项目根目录 `.env.local` / `uploads/` |
| Nginx 配置 | `/etc/nginx/sites-available/agile-platform`，由 sites-enabled 中的链接启用 |
| Certbot | Snap 安装，已确认 5.8.0，命令 `/snap/bin/certbot` |
| TLS 证书 / 私钥 | `/etc/letsencrypt/live/39.96.70.129/fullchain.pem` / 同目录 `privkey.pem` |
| 续期加载脚本 | `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` |

访问链路：浏览器 → HTTPS 443 的 Nginx → 内部 Next.js 3000 → PostgreSQL 16 的 5433；附件实际文件保存在 uploads。公网只开放所需 80/443，SSH 22 限制可信来源，3000/5432/5433 不对公网开放。

使用 IP 并不免除大陆网站的备案要求。本文未确认备案已办理；HTTPS 配置也不代表备案完成。实例续费情况未实时核实。

## 3. 首次部署历史（不要重复初始化）

1. 使用 WindTerm SSH 登录 root，检查系统、内存、磁盘。
2. apt 安装基础工具、Nginx 和 PostgreSQL；添加 NodeSource 源安装 Node.js 24。
3. 创建普通用户与项目目录：

```bash
adduser --disabled-password --gecos "" agile
install -d -o agile -g agile -m 750 /var/www/agile-platform
```

4. 以 agile 克隆 terry/workplace，安装项目依赖。
5. 本地数据来源已明确为 localhost:3000 的开发网站，Docker 容器为 `agilecampus-db`，PostgreSQL 16；不是 localhost:3090 的另一个 Docker 网站。
6. 本地通过 pg_dump 导出后上传。服务器安装 PostgreSQL 16 并创建 `16/main`，因 14 占用 5432，16 使用 5433。创建 `agile_app` 和 `agilecampus`，使用 pg_restore 恢复。
7. 首次恢复核对为 2 用户、2 项目、0 任务、0 附件；这是首次迁移时的数量，**不是现在数据应有的固定数量**。
8. 配置服务器 `.env.local`，构建，使用 systemd 管理，Nginx 反向代理。
9. 申请公网 IP 的 HTTPS 证书，配置跳转、443 和自动续期加载，用户确认无证书警告，模拟续期成功。
10. 第二版停机备份后执行六个增量迁移、构建、启动，用户确认部署成功。

## 4. 环境与后台服务

服务器 `.env.local` 的结构（实际密码不得写入本文）：

```dotenv
DATABASE_URL=postgresql://agile_app:URL编码后的服务器密码@127.0.0.1:5433/agilecampus
AUTH_ALLOWED_ORIGINS=https://39.96.70.129
TRUST_PROXY_IP=true
```

它由 agile 拥有，权限 600。密码中的特殊字符须 URL 编码。生产要求 HTTPS，Secure Cookie 和来源校验不能通过改成开发模式绕过。只有应用端口无法公网直连且 Nginx 覆盖 X-Real-IP 时才信任代理 IP。

已使用的 `/etc/systemd/system/agile-platform.service`：

```ini
[Unit]
Description=Agile Development Platform
Wants=postgresql@16-main.service
After=network.target postgresql@16-main.service

[Service]
Type=simple
User=agile
Group=agile
WorkingDirectory=/var/www/agile-platform
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /var/www/agile-platform/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
UMask=0027

[Install]
WantedBy=multi-user.target
```

服务已 enable。系统服务命令用 root，拉取、npm 安装、构建用 agile。`systemctl daemon-reload` 只在修改服务配置后执行；它不是每次代码发布的步骤。

## 5. HTTPS 和 Nginx 的实际配置

以下为本次使用的配置基准；接手时先查看现有文件，不直接覆盖后续维护者的变更。

```nginx
server {
    listen 80;
    server_name 39.96.70.129;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }
    location / {
        return 301 https://39.96.70.129$request_uri;
    }
}
server {
    listen 443 ssl;
    server_name 39.96.70.129;
    ssl_certificate /etc/letsencrypt/live/39.96.70.129/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/39.96.70.129/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 105m;
    client_body_timeout 300s;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

证书通过 webroot 签发，不使用 nginx 插件申请 IP 证书：

```bash
/snap/bin/certbot certonly --webroot --webroot-path /var/www/letsencrypt --preferred-profile shortlived --ip-address 39.96.70.129
```

这是首次签发历史命令，已有证书不必每次发布重新申请。IP 证书约 6 天有效，本次最初证书到期日为 2026-10-19，续期后日期会变化，必须检查实际证书。

续期加载脚本内容：

```sh
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
```

脚本权限 750。Certbot 已创建续期计划；接手时确认定时任务及模拟续期：

```bash
/snap/bin/certbot certificates
systemctl list-timers --all | grep -i certbot
/snap/bin/certbot renew --dry-run --run-deploy-hooks
```

检查通过标准：模拟续期全部成功、浏览器无证书警告。不得删除 HTTP 的 ACME 验证路径或阻断公网 80，否则后续续期可能失败。不要用 curl -k 隐藏证书错误。

## 6. 每次发布前的检查

电脑：本地测试和 build 成功，核对分支，提交并推送必要文件。未提交或未推送的改动不会部署。不要自动提交用户当前工作区的其他改动。

服务器 agile 会话：

```bash
cd /var/www/agile-platform
whoami
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin terry/workplace
git --no-pager log --oneline HEAD..origin/terry/workplace
git diff --stat HEAD..origin/terry/workplace
```

要求工作区干净、分支正确。记录完整旧提交号和目标提交号。检查当前版本 `docs/deployment.md`、`package.json`、数据库脚本及 schema；不要只重复过去的迁移列表。

本次会话后工作区出现成员多分工脚本 `db:add-member-duties` 和聊天时间迁移说明等新改动，**没有证据证明这些后续迁移已在线执行**。聊天时间转换必须按 `docs/chat-timezone.md` 先检查列类型和历史时区，不猜测时区、不盲目重复转换。

## 7. 停机和备份（root，同一个终端）

当前采用单目录构建，先安排维护窗口停止服务；否则 npm ci 与 build 会修改运行文件。重启服务器后服务可能自动启动，须再次确认停止。

```bash
systemctl stop agile-platform
systemctl is-active agile-platform
ss -lntp 'sport = :3000'
```

应 inactive，3000 无监听。本次 Next.js 停止曾返回 143，systemd 记为 failed；日志显示与人为 stop 同时发生。只有确认这一原因后才 `systemctl reset-failed agile-platform`，不要把其他 failed 状态当作正常。

```bash
BACKUP_DIR="/var/backups/agile-platform/release-$(date +%Y%m%d-%H%M%S)"
install -d -o postgres -g postgres -m 700 "$BACKUP_DIR"
runuser -u agile -- git -C /var/www/agile-platform rev-parse HEAD > "$BACKUP_DIR/previous-commit.txt"
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_dump -p 5433 -d agilecampus -Fc --no-owner --no-acl -f "$BACKUP_DIR/database.dump"
```

上一条成功后再检查：

```bash
/usr/lib/postgresql/16/bin/pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"
```

目录可读只是初步校验，不等于完成恢复演练。继续备份附件和环境：

```bash
if [ -d /var/www/agile-platform/uploads ]; then
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C /var/www/agile-platform uploads
  tar -tzf "$BACKUP_DIR/uploads.tar.gz" > "$BACKUP_DIR/uploads-contents.txt"
else
  printf '%s\n' '备份时 uploads 目录不存在' > "$BACKUP_DIR/no-uploads.txt"
fi
cp -p /var/www/agile-platform/.env.local "$BACKUP_DIR/env.local"
chmod -R go-rwx "$BACKUP_DIR"
printf '%s\n' "$BACKUP_DIR"
ls -lh "$BACKUP_DIR"
```

逐条确认成功。通过 root SFTP 下载整套到电脑，保存在受限目录，不放入 Git 或 public。变量只在当前 shell 有效，换窗口后要重新设为已经打印的实际路径，不能使用空变量继续操作。

历史第二版备份：`/var/backups/agile-platform/release-20261013-093412`，包含 database.dump、env.local、previous-commit.txt、目录清单及 no-uploads.txt；当时无 uploads 目录。历史旧提交：`1bd30f379c605ce032cbbd9c81345d52b109ad72`。**今后发布应重新备份并记录当前提交，不能沿用这个旧恢复点。**

## 8. 更新、迁移与构建（agile）

root 会话执行 `su - agile` 后：

```bash
cd /var/www/agile-platform
git pull --ff-only origin terry/workplace
npm ci --include=dev
```

每条成功才继续。保留 `.env.local` 和 uploads；配置变更使用 `nano .env.local`，不输出密码。

第二版已经成功执行的历史增量脚本：

```bash
npm run db:add-member-duty
npm run db:add-member-duties
npm run db:add-task-checklist
npm run db:add-task-collaborators
npm run db:add-milestones
npm run db:add-team-invites
npm run db:add-auth-protection
npm run db:add-file-cleanup
npm run db:add-project-course
```

它们增加成员分工、里程碑字段、邀请码、登录限流、文件清理触发器和课程字段。后续发布根据实际改动选择迁移，并检查脚本是否可以重复执行。已有数据库不常规运行 db:push 或 db:seed；触发器不能仅靠 db:push 创建。

迁移成功、结构确认后：

```bash
npm run build
```

构建失败不要启动。不要用 root 运行 npm，避免生成 root 所有的项目文件。

## 9. 启动与验收（root）

```bash
systemctl start agile-platform
systemctl status agile-platform --no-pager -l
curl -I http://127.0.0.1:3000
curl -I https://39.96.70.129
```

预期服务 running、页面 200 或符合预期的跳转。只更新代码不必重启数据库或 Nginx；修改 Nginx 后必须先 `nginx -t` 成功，再 reload。

浏览器实际验收：退出重新登录、刷新保留登录、已有数据、本次修复、权限、任务读写、附件上传下载撤回。使用临时文件，不删除真实交付材料。首页 200 和未登录接口 401 均不能证明数据库读写正常。

## 10. 故障与回退

```bash
journalctl -u agile-platform -n 100 --no-pager
tail -n 50 /var/log/nginx/error.log
pg_lsclusters
nginx -t
```

- 502：先查网站服务和内部 3000；连接超时：查网络、监听、防火墙和安全组。
- POST 503：检查 HTTPS 的 AUTH_ALLOWED_ORIGINS；403：查来源与权限；500：查应用日志和数据库结构。
- 上传 413：检查应用 100MB 限制、Nginx 105MB、其他代理限制。
- GitHub 曾连接超时，用户重启后拉取成功；**这不是已证明的根因，也不是每次 Git 卡住就重启的理由**。先 `curl -4 -I --connect-timeout 10 --max-time 20 https://github.com` 对比其他网站并检查代理。`http.connectTimeout` 不是有效的 Git 标准配置，不依赖它控制超时。不关闭 TLS 校验、不添加不明代理。
- 多行 `<<'SQL'` 或 `<<'EOF'` 后出现 `>` 表示等待结束标记，单独一行顶格输入标记；不是数据库报错。

回退先停止网站，保留失败日志与当前数据，核对数据库是否兼容旧代码。若无不兼容迁移，agile 在干净工作区执行 `git switch --detach <本次发布前提交号>`，重新 npm ci、build，root 启动并验收。后续正常发布切回 terry/workplace。不要强制重置或删除文件。

数据库恢复是独立的高影响操作，需制定恢复计划；附件必须与备份配套，备份后的新数据可能丢失。不要仅为回退代码就自动恢复数据库。

## 11. 新会话的第一组命令

root：

```bash
whoami
systemctl status agile-platform --no-pager -l
pg_lsclusters
/usr/bin/node -v
/snap/bin/certbot certificates
```

agile：

```bash
cd /var/www/agile-platform
git status --short
git branch --show-current
git log -1 --oneline
```

将结果与本文核对，再决定执行发布、修复或配置变更。本文不包含密码，也不宣称记录后服务器没有发生变化。
