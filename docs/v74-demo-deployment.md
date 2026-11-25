# v7.4 演示部署与验收手册（原服务器 · 独立演示实例）

状态：**已提交并推送，待部署**。截至 2026-11-24（Asia/Hong_Kong），本机代码已通过类型检查、单元测试、lint 与 Webpack 生产构建，并已提交到 `terry/v74-project-docs`；最终发布提交号以第 3 节 `git rev-parse HEAD` 为准。登录与执行由操作者通过 WindTerm 完成，本文所有服务器命令按「粘贴一条、核对输出、再执行下一条」使用。

本文是[服务器交接手册](server-handoff.md)、[部署与迁移说明](deployment.md)、[v7.4 生产部署方法](release-v7.4.md)在**本次演示场景**下的具体化版本：路径、服务名、端口沿用交接手册的真实值；安全规则（HTTPS、可信来源、备份、禁止 db:push）不因演示而放宽。现场与本文件不一致时，以现场观察到的为准，先停下来记录。

演示数据包见 [demo-v74/README.md](demo-v74/README.md)；本文第 11 节把它展开成可照着点的界面步骤。

---

## 0. 现在的进度与门禁

| 项目 | 状态 | 说明 |
|---|---|---|
| 代码改动（性能优化等 40+ 个文件） | **已提交并推送** | 分支 `terry/v74-project-docs`；真实发布提交以第 3 节 `git rev-parse HEAD` 为准。 |
| 本机校验 | **已通过**（针对发布提交） | 见第 2 节实测记录；最终提交上已重跑类型检查、测试、lint、Webpack 构建。 |
| 服务器登录与盘点 | 未开始 | 第 4 节。 |
| 停机、备份、建演示库 | 未开始 | 第 5–6 节。 |
| 迁移、构建、启动 | 未开始 | 第 7–10 节。 |
| 演示数据录入与验收 | 未开始 | 第 11–12 节。 |

**发布门禁**：本机改动提交并推送到远端后，才能进入第 3 节的版本锁定。在提交之前可以做第 4 节的服务器只读盘点，但不要动代码。

**本次已确认的决策**（来自与操作者的确认）：

1. 演示数据放进**独立演示库**和**独立附件目录**，原库、原附件、原配置保持不动，可随时切回；演示结束后再决定合并或清理。
2. 服务器操作由操作者本人执行，本文把每条命令写成可直接粘贴的形式，并给出预期输出和失败处理。

---

## 1. 部署速览（不变量）

现场核对一遍再开工，任一项不符先停下来记录差异。

| 项目 | 值 |
|---|---|
| 公网地址 | `https://39.96.70.129`（IP 证书，约 6 天有效） |
| 项目目录 | `/var/www/agile-platform` |
| 应用用户 / 系统用户 | `agile` / `root` |
| 服务名 | `agile-platform.service`（systemd，监听 `127.0.0.1:3000`） |
| 数据库 | PostgreSQL 16，端口 **5433**，现有库 `agilecampus`，账号 `agile_app` |
| **本次演示库** | **`agilecampus_demo`**（由 `agilecampus` 克隆） |
| 附件根目录（现有） | `/var/www/agile-platform/uploads` |
| **本次演示附件目录** | **`/var/www/agile-platform/uploads-demo`**（现有目录的副本） |
| 环境文件 | `/var/www/agile-platform/.env.local`（`agile:agile`，600） |
| 备份目录 | `/var/backups/agile-platform/demo-release-<时间戳>` |
| 回退点 | 部署前记录的提交号 + 第 5 节备份 + `.env.local.prod` |

**停机影响**：本次是单目录部署，`npm ci`、`npm run build` 会改动正在运行的文件，因此第 5–10 节必须停机完成，`https://39.96.70.129` 在窗口内不可访问。按现有服务器规模，迁移 + 构建预计 5–15 分钟；实际以现场为准。

**本次不做的事**：不执行 `db:push`、`db:seed`；不删除或覆盖现有 `uploads/`；不在现有 `agilecampus` 库上做任何写入（第 13 节如选择切回旧库，才按那里的步骤补迁移）。

---

## 2. 阶段 A · 本机：发布前校验

### 2.1 先跑一遍（提交前后各一次）

```powershell
cd D:\InteractionDesign\Project\Agile-Development-Platform-v74-docs
git status --short --branch
npx tsc --noEmit
npm test
npm run lint
npm run build
```

通过标准：`tsc` 退出码 0；`npm test` 除下文已知项外全部 pass；`lint` 0 error；`build` 退出码 0 且输出路由表。

### 2.2 本机已知限制（不是代码缺陷）

- **`node_modules` 必须是真实目录（2026-11-25 已修复）**：此前本仓库的 `node_modules` 是指向同级目录 `Agile-Development-Platform-terry\node_modules` 的目录联接（junction），Turbopack 会拒绝解析工作区以外的符号链接，报 `Symlink [project]/node_modules is invalid, it points out of the filesystem root`。现已改为项目内 `npm ci` 装出的真实目录，`npm run build`（Turbopack）可直接通过；只有重新建过 junction 的目录才需要退回 `npx next build --webpack`。
- **`npm test` 需要显式测试库**：`tests/phase-2-baseline.test.mjs` 故意要求 `DATABASE_URL` 指向专用库 `agilecampus_test_20261112`；不设置时该项报 `explicit test DATABASE_URL is required`，这是环境前置条件，不是回归。把 `DATABASE_URL` 指向该库后为 **114 pass / 0 fail / 2 skipped**。

### 2.3 本次实测记录（2026-11-24，发布代码状态）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0，无输出 |
| `npm test`（`DATABASE_URL` 指向 `agilecampus_test_20261112`） | 114 pass / 0 fail / 2 skipped |
| `npm run lint` | 0 error，0 warning |
| `npx next build --webpack` | 退出码 0，路由表完整输出 |
| 工作台首屏 A/B | 24 对交替样本：第一张卡 128.6→104.7 ms（-18.6%），见 `workspace-loading-measurement.md` |

提交完成后已对最终提交重跑 2.1；部署时把实际提交号和结果填进第 16 节记录表。

### 2.4 本轮（2026-11-25）回归记录：响应式与页脚修正

改动范围：工作台响应式重构（`globals.css` / `workspace/page.tsx` / `TopBar.tsx` / `shared.tsx` / `ProjectActivitySidebar.tsx` / 新增 `WorkspaceShell.tsx`）、首页与导引页页脚配色（`home.css` / `guide/guide.css`）。

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0，无输出 |
| `npm test`（`DATABASE_URL` → `agilecampus_test_20261112`） | 114 pass / 0 fail / 2 skipped |
| `npm run lint` | 0 error，0 warning |
| `npm run build`（Turbopack，未经 `--webpack`） | 退出码 0，路由表完整输出 |

浏览器实测（Chrome 无头 + 真实组件 + 接口 mock，1440×900 视口）：

| 视口 | 左侧图标栏 | 项目列表 | 右侧概览 | 横向溢出 |
|---|---|---|---|---|
| 1600 | 0~64 | 64~314（常驻） | 248（速览） | 无 |
| 1100 | 0~64 | 64~314（常驻） | 36（自动收起） | 无 |
| 950 | 0~64 | 屏外 -250~0（`≡` 呼出） | 36 | 无 |
| 780 | 0~64 | 屏外 -250~0（`≡` 呼出） | 36 | 无 |
| 950（抽屉打开） | 0~64 | 64~314 + 遮罩 | 36 | 无 |

另：首页深/浅两套主题页脚背景均为透明（旧落地页 `footer{background:var(--blue)}` 已复位），导引页底部操作条 padding 由 `22px 6vw 35px` 恢复为 `22px 0 0`。

---

## 3. 阶段 B · 本机：锁定版本（提交并推送之后）

```powershell
cd D:\InteractionDesign\Project\Agile-Development-Platform-v74-docs
git status --short --branch
git rev-parse HEAD
git log -1 --oneline
git ls-remote --heads origin terry/v74-project-docs
```

通过标准：工作区干净（或只剩明确不发布的文件）；`git rev-parse HEAD` 与 `git ls-remote` 输出的远程分支提交**完全相同**；日志首行就是你要发布的提交。

把两处输出的 40 位完整提交号抄下来，记为 **`<目标提交>`**。若本地有未推送提交，先 `git push origin terry/v74-project-docs` 再重跑。

> 后文所有 `<目标提交>`、`<回退提交>` 都是占位符，粘贴命令时**要替换成实际提交号，尖括号一起删掉**。

> 分支说明：服务器当前部署的是 `terry/workplace`。本次不依赖分支跟踪，服务器用**分离头**检出 `<目标提交>`（第 7 节），这样发布的是确切的提交内容，也不会改变服务器现有分支配置。

---

## 4. 阶段 C · 服务器：只读盘点（不停机）

WindTerm 用 root 登录，依次执行并记录。**这一段全部只读，不改任何东西。**

```bash
date -Is
whoami
systemctl status agile-platform --no-pager -l | head -n 5
systemctl is-active agile-platform nginx
/usr/bin/node -v
pg_lsclusters
df -h /
du -sh /var/www/agile-platform/uploads
```

```bash
cd /var/www/agile-platform
su - agile -c 'cd /var/www/agile-platform && git status --short --branch && git rev-parse HEAD && git log -1 --oneline'
```

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d postgres -c '\l agilecampus*'
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;"
```

### 4.1 关键探测：文档系统装没装

v7.4 的「云文档」面板依赖文档系统的表与触发器，而第四版的迁移清单里**没有** `db:add-documents`，所以线上很可能从未装过。这一步决定第 9 节要多做多少事：

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus -c "
SELECT to_regclass('public.document_migrations') AS has_document_migrations,
       to_regclass('public.docs') AS has_docs,
       to_regclass('public.dm_messages') AS has_dm,
       to_regclass('public.personal_todos') AS has_suite,
       to_regclass('public.password_reset_tokens') AS has_reset;"
```

- 全部为 `NULL`：这是第四版库，第 9 节要把 v5–v7.4 的迁移全部补上，并首次安装文档系统。
- `document_migrations` 有值：文档系统已装。继续执行下一条，核对校验和：

```bash
cd /var/www/agile-platform
node -e "const{createHash}=require('crypto'),fs=require('fs');let h=createHash('sha256');for(const f of['db/migrations/001-documents.sql','db/migrations/002-document-guards.sql'])h=h.update(fs.readFileSync(f,'utf8'));console.log('current-001+002-checksum',h.digest('hex'))"
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus -c "SELECT key, checksum FROM document_migrations WHERE key IN ('documents-schema-v1','documents-api-cutover-v1');"
```

比较两处值。**当前代码算出的应为 `c47fa5b48cab49dbdee585f325001ef48c3f3969ef50906a0ae7a7eace07b757`**（本机已核对）。若库里记录的值不同，说明该库是用更早版本的 SQL 装的，`db:add-documents` 会以 `DOCUMENT_MIGRATION_CHECKSUM_MISMATCH` 拒绝执行——**此时停下来**，不要格式化或改写 `db/migrations/*.sql` 去迁就，先记录两个值再决定。

### 4.2 记录表（本阶段填完）

| 项目 | 实测值 |
|---|---|
| 检查时间 | |
| 当前线上提交 | |
| 服务状态 / 监听 | |
| Node 版本 | |
| 数据库大小 / uploads 大小 / 根分区可用 | |
| 文档系统：已装 / 未装 | |
| 证书到期日（`/snap/bin/certbot certificates`） | |

---

## 5. 阶段 D · 服务器：停机与全量备份

> 从这里开始进入维护窗口。每条命令确认成功再执行下一条；`BACKUP_DIR` 变量只在当前终端有效，换窗口要重新设为已打印的实际路径。

### 5.1 停机

```bash
systemctl stop agile-platform
systemctl is-active agile-platform
ss -lntp 'sport = :3000'
```

应为 `inactive`，且 3000 无监听。Next.js 停止时偶尔返回 143 并被 systemd 记为 failed，只有在确认与人为 stop 同时发生时，才执行 `systemctl reset-failed agile-platform`。

### 5.2 备份数据库、附件、环境文件

```bash
BACKUP_DIR="/var/backups/agile-platform/demo-release-$(date +%Y%m%d-%H%M%S)"
install -d -o postgres -g postgres -m 700 "$BACKUP_DIR"
printf '%s\n' "$BACKUP_DIR"
runuser -u agile -- git -C /var/www/agile-platform rev-parse HEAD > "$BACKUP_DIR/previous-commit.txt"
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_dump -p 5433 -d agilecampus -Fc --no-owner --no-acl -f "$BACKUP_DIR/database.dump"
```

```bash
/usr/lib/postgresql/16/bin/pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"
if [ -d /var/www/agile-platform/uploads ]; then
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C /var/www/agile-platform uploads
  tar -tzf "$BACKUP_DIR/uploads.tar.gz" > "$BACKUP_DIR/uploads-contents.txt"
else
  printf '%s\n' '备份时 uploads 目录不存在' > "$BACKUP_DIR/no-uploads.txt"
fi
cp -p /var/www/agile-platform/.env.local "$BACKUP_DIR/env.local"
chmod -R go-rwx "$BACKUP_DIR"
ls -lh "$BACKUP_DIR"
```

通过标准：`database.dump` 非空、`pg_restore --list` 输出里能看到表条目、`uploads-contents.txt` 行数合理、`env.local` 存在。

用 root SFTP 把这套备份下载到本机受限目录（不要放进 Git 或 `public/`）。记下 `previous-commit.txt` 里的提交号，记为 **`<回退提交>`**。

---

## 6. 阶段 E · 服务器：建演示库与演示附件目录

### 6.1 为什么用克隆而不是新建空库

本次实测过「空库 → `db:push` → `db:add-documents`」这条路：`db:push` 会按 `db/schema.ts` 先把 59 张表（含 `document_*`）建出来，随后 `db:add-documents` 的 001 迁移执行到第 1 条就失败（`relation "document_spaces" already exists`）；反过来先跑 `db:add-documents` 也会失败（001 的第 22 条引用 `public.teams`，空库还没有）。**空库初始化目前没有可直接照抄的生产命令**，所以演示库改为克隆现有库：结构、文档系统记录、触发器、数据一次性到位，后续只需跑增量迁移。

### 6.2 克隆

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/createdb -p 5433 -O agile_app -T agilecampus agilecampus_demo
```

- `-T agilecampus` 要求**没有任何会话连着 `agilecampus`**（应用已在 5.1 停止）。
- 若报 `source database "agilecampus" is being accessed by other users`，说明还有别的连接：`runuser -u postgres -- psql -p 5433 -d postgres -c "SELECT pid, usename, application_name, state FROM pg_stat_activity WHERE datname='agilecampus';"` 逐个确认来源，**不要**为了克隆去强杀不认识的会话，先判断是不是自己遗留的 psql 窗口。

核对：

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus_demo -c "
SELECT current_database(), pg_size_pretty(pg_database_size(current_database())) AS size,
       (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS tables,
       (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM teams) AS teams,
       (SELECT count(*) FROM projects) AS projects,
       (SELECT count(*) FROM attachments) AS attachments;"
```

`tables` 和 `users/teams/projects/attachments` 应与 `agilecampus` 一致（对比 4.2 记录的值；库刚克隆，数据只可能相同）。

克隆是**含数据**的：原库的团队、项目、附件记录、账号都会出现在演示实例里，原库会话记录也在（同一浏览器此前留下的 Cookie 仍可能有效）。演示账号是第 11 节新注册的，不依赖这些旧账号；课堂展示时从演示专用项目进入即可。

### 6.3 建立独立附件目录

```bash
cd /var/www/agile-platform
if [ -d uploads ]; then
  cp -a uploads uploads-demo    # -a 会连同 .document-exports 等隐藏目录一起复制
else
  install -d -o agile -g agile -m 750 uploads-demo
fi
chown -R agile:agile uploads-demo
chmod 750 uploads-demo
du -sh uploads uploads-demo 2>/dev/null
ls -ld uploads uploads-demo
```

通过标准：`uploads-demo` 大小与 `uploads` 接近、属主 `agile:agile`、权限 `drwxr-x---`。

> 为什么复制而不是共用：演示库里的附件记录与原库同名，若共用同一目录，在演示实例里撤回/删除附件会连带删掉原库仍在引用的文件。复制后两个实例的文件彻底分开。

> 已知代码不一致（本次不修，演示不涉及）：私聊文件上传接口把路径硬编码成 `<项目>/uploads`，不读 `UPLOAD_DIR`。所以演示环境里**私聊**文件会写进原 `uploads/`，与本手册无关；课堂演示清单不含私聊，忽略即可。

---

## 7. 阶段 F · 服务器：更新代码与依赖

以 root 执行 `su - agile` 后：

```bash
cd /var/www/agile-platform
git status --short
git fetch origin terry/v74-project-docs
git cat-file -t <目标提交>
git switch --detach <目标提交>
git rev-parse HEAD
```

通过标准：`git status --short` 为空；`cat-file` 输出 `commit`；`rev-parse HEAD` 与第 3 节记录的 `<目标提交>` **逐字符一致**。

若 `git status --short` 不为空（服务器上有本地改动），**停下来**：不要 `reset --hard`、不要 `checkout .`，先看清改的是不是 `.env.local`/`uploads` 之外的文件。

```bash
npm ci --include=dev
```

需要几分钟，实际是重新安装全部依赖（本次 `package-lock.json` 没有变化，但仍按发布流程执行）。失败时先排查网络（`curl -4 -I --connect-timeout 10 --max-time 20 https://registry.npmjs.org`），不临时修改依赖版本。

---

## 8. 阶段 G · 服务器：把环境指向演示实例

### 8.1 先留一份原配置

```bash
cd /var/www/agile-platform
cp -p .env.local .env.local.prod
chown agile:agile .env.local.prod
chmod 600 .env.local.prod
ls -l .env.local .env.local.prod
```

`.env.local.prod` 是第 14 节回退要用的，**不要提交到 Git**（`.gitignore` 已覆盖 `.env*`，确认一下即可）。

### 8.2 修改 `.env.local`

```bash
nano /var/www/agile-platform/.env.local
```

只改两处，其余原样保留（**不要**在文档、聊天或截图里暴露密码）：

```dotenv
DATABASE_URL=postgresql://agile_app:<URL 编码后的原密码>@127.0.0.1:5433/agilecampus_demo
AUTH_ALLOWED_ORIGINS=https://39.96.70.129
TRUST_PROXY_IP=true
UPLOAD_DIR=/var/www/agile-platform/uploads-demo
```

- `DATABASE_URL` 只把库名从 `agilecampus` 换成 `agilecampus_demo`，用户名、密码、端口不变。
- `UPLOAD_DIR` 用**绝对路径**，避免工作目录变化带来歧义；不设时会退回 `<项目>/uploads`。
- 不要把 `DOCUMENT_UI_REHEARSAL` 写进这里——它会把构建产物改到 `.next-document-check`，`next start` 找不到生产构建。

核对（不回显密码）：

```bash
cd /var/www/agile-platform
node -e "require('dotenv').config({path:'.env.local'});const u=new URL(process.env.DATABASE_URL);console.log('db =',u.pathname.slice(1),'@',u.hostname+':'+u.port);console.log('origins =',process.env.AUTH_ALLOWED_ORIGINS);console.log('upload =',process.env.UPLOAD_DIR)"
```

预期：`db = agilecampus_demo @ 127.0.0.1:5433`，`origins = https://39.96.70.129`，`upload = /var/www/agile-platform/uploads-demo`。

---

## 9. 阶段 H · 服务器：在演示库上执行迁移

仍以 `agile` 用户在 `/var/www/agile-platform` 执行。**下列脚本都从 `.env.local` 读 `DATABASE_URL`，所以此时它们作用于 `agilecampus_demo`**；每个脚本会吞掉真实错误只打印一句中文提示，**必须逐条看退出码**。

先确认迁移脚本真正会写到哪个库（在 `agile` 会话里执行，读的就是脚本用的同一份配置）：

```bash
cd /var/www/agile-platform
node -e "require('dotenv').config({path:'.env.local',quiet:true});const u=new URL(process.env.DATABASE_URL);console.log('migrations will write to:',u.pathname.slice(1))"
```

应输出 `migrations will write to: agilecampus_demo`。**若输出 `agilecampus`，立即停止**：说明第 8 节的环境切换没生效，继续执行会把 v5–v7.4 的表写进生产库。

### 9.1 必做：v5–v7 新增的六个脚本（按顺序）

```bash
npm run db:add-docs            && echo "OK add-docs"
npm run db:add-direct-messages && echo "OK add-direct-messages"
npm run db:add-message-extras  && echo "OK add-message-extras"
npm run db:add-chat-attachments && echo "OK add-chat-attachments"
npm run db:add-password-reset  && echo "OK add-password-reset"
npm run db:add-personal-suite  && echo "OK add-personal-suite"
```

顺序有依赖：`db:add-message-extras` 会改 `dm_messages`，必须在 `db:add-direct-messages` 之后。六条都幂等，可重跑。

### 9.2 条件性：文档系统

先看 4.1 的结论：

- **演示库有 `document_migrations`（即原库已装）**：直接跑下面两条做幂等核对（已装时会输出 `already-applied`）：

```bash
npm run db:add-documents -- --database=agilecampus_demo --backfill
npm run db:add-documents -- --database=agilecampus_demo --backfill --cutover
```

- **原库没装过文档系统**：同样跑上面两条，但这是**首次安装**：001+002 建表并装齐 `document_*` 触发器，`--backfill` 把演示库里已有的附件/链接搬成文档资源，`--cutover` 打开新接口开关。这条是本次唯一的长事务（对 `teams/projects/attachments/tasks/milestones/milestone_resources` 加 `SHARE ROW EXCLUSIVE` 锁，期间这些表能读不能写；应用已停机所以无影响），失败会整体回滚，不产生半装状态以外的残留。

通过标准：第一条打印含 `"schema":"applied"` 或 `"already-applied"`、`"status":"applied"` 的 JSON；第二条再打印一次，并出现 `"mode":"canonical-documents"` 或在 `document_migrations` 里看到 `documents-api-cutover-v1`。

### 9.3 服务器结构核对（只读 SQL）

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus_demo -c "
SELECT to_regclass('docs') IS NOT NULL AS docs_ready,
       to_regclass('doc_comments') IS NOT NULL AS doc_comments_ready,
       to_regclass('dm_messages') IS NOT NULL AS dm_ready,
       to_regclass('dm_attachments') IS NOT NULL AS dm_files_ready,
       to_regclass('password_reset_tokens') IS NOT NULL AS reset_ready,
       to_regclass('personal_todos') IS NOT NULL AS suite_ready,
       to_regclass('file_cleanup') IS NOT NULL AS cleanup_ready,
       to_regclass('task_checklist_items') IS NOT NULL AS checklist_ready,
       to_regclass('milestone_resources') IS NOT NULL AS milestone_res_ready,
       to_regclass('document_spaces') IS NOT NULL AS documents_ready;"
```

全部应为 `t`。

```bash
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus_demo -c "
SELECT key FROM document_migrations ORDER BY applied_at;"
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -p 5433 -d agilecampus_demo -c "
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = to_regclass('attachments') AND NOT tgisinternal;"
```

预期：`document_migrations` 至少有 `documents-schema-v1`、`documents-backfill-v1`、`documents-api-cutover-v1`、`documents-operations-v1`；触发器里应能看到 `attachments_file_cleanup` 与文档系统的守卫触发器，`tgenabled` 为 `O` 或 `A`。

---

## 10. 阶段 I · 服务器：构建、启动、探活

`agile` 用户：

```bash
cd /var/www/agile-platform
npm run build
```

构建失败**不要启动**。失败先记录完整错误，再判断是代码问题还是环境问题（内存不足、磁盘满、Node 版本）。

root 启动：

```bash
systemctl start agile-platform
systemctl status agile-platform --no-pager -l | head -n 20
curl -I http://127.0.0.1:3000
curl -I https://39.96.70.129
```

通过标准：服务 active (running)；本地 3000 返回 200 或预期跳转；公网 HTTPS 无证书警告。

```bash
journalctl -u agile-platform -n 60 --no-pager
```

关注启动阶段是否出现 `[documents]` 相关异常、数据库连接错误。文档导出/清理后台任务只会在常驻进程里跑（导出约 5 秒一次、清理约 60 秒一次），本轮演示不依赖它们，但日志里不应出现持续报错。

---

## 11. 阶段 J · 浏览器：录入演示数据（约 30–45 分钟）

以下步骤按界面实际文案写，路径来自代码核对。**Day 0 取实际录入日期**，其他日期按 `docs/demo-v74/演示数据.json` 的 `dueDay` 顺延。账号口令另行保存，不写进任何文档。

**开始前**：用无痕窗口打开 `https://39.96.70.129`，确认站点可用；确认 `/api/document-status` 返回 `enabled:true`（登录后新标签页打开该地址）。若为 `false`，说明第 9.2 节的 cutover 没成功，先回去处理。

> 演示实例是原库的克隆，所以团队/项目列表里会看到原有的团队与项目。课堂展示时用第 11.3 节新建的「校园活动报名 · 课程演示」进入，不要去点旧数据。

### 11.1 注册两个账号并改显示名

1. 打开 `https://39.96.70.129/login` → 切到「注 册」页签。
2. 字段是「学工号」「邮箱」「密码」（密码至少 6 位，无邀请码、无邮箱验证）。填 `DEMO74001` / `camp-owner@example.test` / 自定密码 → 点「注册并登录」。
3. 注册成功会落到**营销首页**，点页面上的「进入工作台」才进 `/workspace`。
4. **注册时没有姓名字段**，必须进「设置」（`/settings`）→「名称」填 `林青禾` →「保存修改」，否则全站显示学工号。
5. 用右上头像「退出用户」退出，重复 2–4 注册 `DEMO74002` / `camp-member@example.test` / 另一个密码，名称填 `陈星野`。

### 11.2 建团队、加成员

1. 以 `林青禾` 登录 → 图标栏「团队管理」→「＋ 创建团队」→「团队名称」填 `青禾课程小组` →「创建团队」。
2. 团队卡片「管理成员」→ 右上「邀请成员」→ 填 `camp-member@example.test` →「发送邀请」。对方已注册，**无需确认**即加入。
3. （可选，演示要用到负责人标签）成员卡片「分配分工」→ 勾选「负责人（组长）」给林青禾，「开发者」给陈星野 →「保存分工」。创建者默认已带负责人标签。

### 11.3 建课程项目

1. 图标栏「项目管理」→「＋ 创建项目」。
2. 字段：「所属团队」=`青禾课程小组`；「项目名称」=`校园活动报名 · 课程演示`；「编号前缀」=`CAMP`（2–6 位大写字母/数字，首字符必须字母，团队内唯一）；「所属课程（可选）」=`交互设计实践` →「创建项目」。
3. 卡片「进入项目」。

### 11.4 建迭代（只有负责人能建）

1. 左侧项目列表底部 SPRINT 卡片「＋ 创建迭代」（已有迭代时是卡片右上的「＋」）。
2. 「名称」=`迭代一 · 报名闭环`；「迭代目标」=`学生能浏览活动并收到报名确认`；起始/交付日期按 Day 0 / Day 7；保持「立即启动」勾选 →「创建迭代」。
3. 任务不会自动进迭代，建任务时在「迭代」下拉里选。

### 11.5 建三个任务并改状态

按 `scope → confirm → handoff` 的顺序建，任务编号才会是 `CAMP-001/002/003`。

1. 「项目任务」→「＋ 新建任务」。字段只有：标题、描述、优先级、截止日期、负责人、协作成员、迭代、标签。**新建弹窗里没有「状态」字段**，新任务默认「待开始」。
2. 依次录入：

| 顺序 | 标题 | 描述 | 负责人 | 优先级 | 截止 | 迭代 |
|---|---|---|---|---|---|---|
| 1 | 确认活动报名字段 | 确定活动名称、报名人及报名状态三个字段，并记录重复报名的处理规则。 | 林青禾 | 中 | Day 0 | 迭代一 |
| 2 | 验证报名确认与重复提交 | 按验收样例走通首次报名、重复提交和满额报名，保存结果。 | 陈星野 | 高 | Day 3 | 迭代一 |
| 3 | 整理课堂演示与交付说明 | 汇总测试结果，在里程碑中提交需求说明和验收附件。 | 林青禾 | 中 | Day 6 | 迭代一 |

3. 建完后改状态（点任务卡打开右侧详情 →「状态与安排」→「状态」下拉，选完自动保存）：
   - 确认活动报名字段 → **已完成**
   - 验证报名确认与重复提交 → **进行中**
   - 整理课堂演示与交付说明 → **待开始**
4. 状态文案固定为：待开始 / 进行中 / 已完成；优先级：高 / 中 / 低。

### 11.6 建里程碑并关联三个任务

1. 「项目概览」→ 右侧「课程里程碑」标题右侧「＋ 创建里程碑」（只有项目 owner/admin 看得到，用林青禾）。
2. 弹窗字段：「名称」=`报名流程课堂验收`；「时间设置方式」换「指定日期」→ 截止日期 Day 7；「交付要求」=`展示报名、重复提交、名额已满三种反馈，从里程碑打开同一份交付附件。`
3. 勾选「关联任务（可选）」里的三条任务（显示为 `CAMP-00x 标题`）。**名称和日期都填好之前「保存」是禁用状态**。
4. 「保存」。卡片应显示「关联任务 1 / 3 已完成」。

### 11.7 云文档：建分区、建在线文档

1. 图标栏「云文档」→ 左上「选择项目」切到 `校园活动报名 · 课程演示`。
2. 根层按钮是「＋ 新建分区」（根层不能直接建文档或上传）→ 名称 `课堂交付` →「创建」。
3. 点进 `课堂交付` →「＋ 新建」→「在线文档」→ 名称 `活动报名与名额规则` →「创建」。
4. 点该文档 →「编辑正文」→「文档标题」填 `活动报名与名额规则`，「Markdown 正文」粘贴 `docs/demo-v74/活动报名与名额规则.md` 全文 →「立即保存」→「保存并结束编辑」。
   （编辑态每 15 秒自动保存，但仍要手动点这两下才算交付。）

### 11.8 成员上传附件并选目录（用陈星野）

1. 退出，用 `陈星野` 登录 →「项目任务」→ 点任务「验证报名确认与重复提交」。
2. 右侧详情滚到「附件与讨论」→「关联资料」→「上传并关联」。
3. 弹窗「选择项目上传目录」→ 点 `▸ 课堂交付` 进入 →「上传到当前目录」变可用 →「上传到当前目录」。
   （此步只能选已有文件夹，不能在此新建。）
4. 弹窗「上传文件」→ 选 `docs/demo-v74/报名验收样例.txt` →「上传」。成功提示「文件已保存到项目目录并完成关联」。单文件上限 100MB。

### 11.9 负责人在里程碑关联这两份资料（用林青禾）

1. 退出，用 `林青禾` 登录 →「项目概览」→ 里程碑卡片「报名流程课堂验收」→「查看关联资料」。
2. 「关联已有资料」→ 面包屑进入 `全部分区 / 课堂交付` → 勾选 `报名验收样例.txt` 与 `活动报名与名额规则` →「关联所选资料（2）」。

---

## 12. 阶段 K · 浏览器：验收

### 12.1 数据与权限

| 检查 | 预期 |
|---|---|
| 林青禾视角 | 项目任务列表三条任务状态正确；里程碑显示关联任务 1/3 |
| 陈星野视角 | 「待办」里第一组是「进行中」，能看到「验证报名确认与重复提交」 |
| 文档 | 云文档 → `课堂交付` → 打开在线文档，三条报名规则完整可读 |
| 时间 | 任务截止日与里程碑日期符合 Day 0 起算的自然日 |

### 12.2 附件一致性（关键项）

源文件 SHA-256（本机已算好，可直接比对）：

| 文件 | SHA-256 |
|---|---|
| `docs/demo-v74/报名验收样例.txt` | `F345CF16F6968F5F73973FCB773FC92A8ECAE4604F475F423E0E4E155AFC9AEC` |

1. 从**任务**「验证报名确认与重复提交」→「关联资料」→ 点文件名 →「下载文件」。
2. 从**里程碑**「报名流程课堂验收」→「查看关联资料」→ 点同一文件名 →「下载文件」。
3. 两次下载都在本机核对：`Get-FileHash -Algorithm SHA256 <下载文件>`，应等于上表值（服务器上可用 `sha256sum`）。

### 12.3 重启复验（证明附件真的落在新目录、数据库引用也正确）

root：

```bash
systemctl restart agile-platform
sleep 5
systemctl is-active agile-platform
curl -I https://39.96.70.129
```

浏览器刷新后，**再次从任务下载同一附件**并核对 SHA-256，同时确认在线文档正文仍完整。记录实际恢复时间。

### 12.4 演示前最后一遍

按 `docs/testing.md` 的快速回归过一遍：登录、刷新保持登录、退出；项目与任务读写；文档打开；附件上传下载；日夜主题切换。

---

## 13. 阶段 L · 收尾与演示后的三种处理

### 13.1 收尾（必做）

1. 把第 16 节记录表填完整：目标提交、回退提交、备份目录、迁移结果、附件 SHA-256、重启恢复时间、验收人。
2. 两个演示账号的口令单独交付（本机受限文件或口令管理器），**不要**写进仓库、文档、截图。
3. 确认 `git status` 里没有把 `.env.local`、`.env.local.prod`、`uploads-demo/` 提交进去。
4. 保留备份目录与 `BACKUP_DIR` 打印的路径，直到演示结束并确认不再需要回退。

### 13.2 演示结束后：三种处理

| 方案 | 操作 | 适用 |
|---|---|---|
| **A. 演示实例转正**（最省事） | 什么都不用改：`https://39.96.70.129` 继续用 `agilecampus_demo` + `uploads-demo`，它已经迁移并验收过 | 演示内容愿意保留，旧库作为备份归档 |
| **B. 回到旧库** | root：停服 → 在**旧库**上补跑同一套迁移（`DATABASE_URL` 临时指向 `agilecampus`，第 9 节同序）→ `cp -p .env.local.prod .env.local` → 重启 → 复验 | 想保留演示前后的两套数据分开管理 |
| **C. 丢弃演示** | root：停服 → `cp -p .env.local.prod .env.local` → 重启旧库（旧库未迁移，需同时回退代码，见第 14 节 R2）→ 确认后再 `dropdb agilecampus_demo`、`rm -rf uploads-demo` | 演示只是临时展示 |

跨方案注意：**不要用 SQL 把演示库里的团队/项目直接拷回旧库**。业务数据要跨实例迁移，只能用界面在目标实例里重做同一份清单（第 11 节），否则外键、附件引用、文档资源都会不一致。

---

## 14. 回滚手册

### R1 · 只回配置（应急过渡，不是最终状态）

```bash
systemctl stop agile-platform
cd /var/www/agile-platform
cp -p .env.local.prod .env.local
systemctl start agile-platform
systemctl is-active agile-platform
curl -I https://39.96.70.129
```

注意：因为第 7 节已经把代码切到 v7.4，旧库没有 v5–v7.4 的表，**只回配置会让云文档、私聊、个人效率中心报错**。R1 只适合「v7.4 代码 + 旧库」这种过渡状态，要彻底恢复还得做 R2。

### R2 · 回退代码（配合 R1）

`agile` 用户：

```bash
cd /var/www/agile-platform
git switch --detach <回退提交>
git rev-parse HEAD
npm ci --include=dev
npm run build
```

root：

```bash
systemctl start agile-platform
systemctl is-active agile-platform
curl -I https://39.96.70.129
```

因为本次迁移**只作用于 `agilecampus_demo`**，旧库结构未被改动，所以代码回退不需要数据库回退——这是本次用独立演示库换来的最大好处。

### R3 · 数据处理（仅在演示库被写坏、需要重来）

```bash
systemctl stop agile-platform
runuser -u postgres -- /usr/lib/postgresql/16/bin/dropdb -p 5433 agilecampus_demo
# 重新克隆（第 6.2 节）并重新迁移（第 9 节），确认无误后再启动：
systemctl start agile-platform
```

**不要**从 `database.dump` 恢复到 `agilecampus`（旧库）——那是最后的退路，不是重来演示用的手段。

### 绝对不要做

- 不要为「修好迁移」去编辑 `db/migrations/001-documents.sql`、`002-document-guards.sql`（校验和一旦变化，库里的记录就对不上）。
- 不要在生产库或演示库上跑 `db:push` / `db:seed`。
- 不要在服务器上 `git reset --hard`、删除 `uploads/`、覆盖 `.env.local` 而不留 `.env.local.prod`。
- 不要用 `curl -k` 绕过证书问题来「确认站点可用」。

---

## 15. 故障对照表

| 现象 | 先查 |
|---|---|
| `git pull/switch` 卡住或超时 | `curl -4 -I --connect-timeout 10 --max-time 20 https://github.com`，对比其他站点；不要关 TLS 校验 |
| `npm ci` 失败 | 磁盘余量、npm 源可达性、`df -h /` |
| 迁移脚本只打印一句中文提示并退出 1 | 真实错误被脚本吞掉了：确认是否在 `/var/www/agile-platform` 下以 `agile` 执行、`.env.local` 是否能被读到、`DATABASE_URL` 指向哪个库（第 8.2 节的核对命令） |
| `DOCUMENT_MIGRATION_CHECKSUM_MISMATCH` | 库里记录的 001+002 校验和与当前 SQL 不一致：不要改 SQL，记录两处值后停下 |
| `DOCUMENT_DDL_STATEMENT_n` | 半装状态或顺序错误：该库已有部分 `document_*` 表但没写迁移记录；按 R3 重建演示库 |
| `DOCUMENT_UNMAPPED_LEGACY_FILES` | `--cutover` 前还有旧附件没被 `--backfill` 映射；先跑 `/backfill` 再 cutover |
| 站点 502 | `systemctl status agile-platform`、`ss -lntp 'sport = :3000'`、`journalctl -u agile-platform -n 100` |
| 登录后仍显示未登录 | 是否用 `https://` 访问；`AUTH_ALLOWED_ORIGINS` 是否与实际来源完全一致 |
| 写请求 503 | `AUTH_ALLOWED_ORIGINS` 缺失或不是 `https://` 来源 |
| 写请求 403 | 来源不匹配；或该操作用了没有权限的账号 |
| 上传 413 | 单文件超 100MB、Nginx `client_max_body_size` 是否 105m |
| 附件下载 404 | `UPLOAD_DIR` 是否指向 `uploads-demo`；文件是否在第 6.3 节复制过来 |
| 云文档面板不可用 | `/api/document-status` 是否为 `enabled:true`；`document_migrations` 是否有 `documents-api-cutover-v1` |
| 任务编号不是 001/002/003 | 创建顺序被打乱；按第 11.5 节顺序删掉重建 |

---

## 16. 执行记录（边做边填）

| 阶段 | 操作 | 时间 | 实际命令或界面操作 | 结果、异常及处理 |
|---|---|---|---|---|
| A | 本机预检（tsc / test / lint / build） | 2026-11-24 | 见第 2.3 节 | tsc 0、114 pass / 0 fail / 2 skipped、lint 0 error、build 0 |
| B | 锁定发布提交 | 待执行 | | |
| C | 服务器只读盘点 | 待执行 | | |
| D | 停机并备份 | 待执行 | | |
| E | 建演示库与演示附件目录 | 待执行 | | |
| F | 更新代码与依赖 | 待执行 | | |
| G | 切换 `.env.local` | 待执行 | | |
| H | 执行迁移并核对结构 | 待执行 | | |
| I | 构建、启动、探活 | 待执行 | | |
| J | 录入演示数据 | 待执行 | | |
| K | 双账号验收与 SHA-256 | 待执行 | | |
| K | 重启复验 | 待执行 | | |
| L | 收尾与交付 | 待执行 | | |

| 记录项 | 值 |
|---|---|
| 目标提交 `<目标提交>` | |
| 回退提交 `<回退提交>` | |
| 备份目录 `BACKUP_DIR` | |
| 演示库名 / 附件目录 | `agilecampus_demo` / `/var/www/agile-platform/uploads-demo` |
| 文档系统：原库已装 / 本次首装 | |
| 服务恢复时间 | |
| 验收人 / 验收时间 | |
