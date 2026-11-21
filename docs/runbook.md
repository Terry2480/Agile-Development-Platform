# 平台运行手册（日常启动 / 日常使用 / 上线检查）

> 目标读者：日常使用与维护本平台的团队成员。服务器部署的完整流程见 `deployment.md` 与 `server-handoff.md`，本文只覆盖「每天能跑起来、用起来」所需的最小操作集。

## 一、日常启动（本地开发环境）

```bash
# 1. 启动数据库（Docker 容器，数据存卷里，重启不丢）
docker compose up -d

# 2. 启动应用
npm run dev
# 打开 http://localhost:3000
```

首次使用（全新数据库）追加：

```bash
npm run db:push        # 建表
npm run db:seed        # 可选：演示数据（生产库禁止执行）
```

故障速查：

| 现象 | 处理 |
| --- | --- |
| 数据库连不上 | `docker ps` 确认容器在跑；确认 `.env.local` 的 DATABASE_URL 端口为 5432 |
| 页面 500 | 看 dev server 终端输出；缺表时执行 `npm run db:push` |
| 端口被占 | `npm run dev -- --port 3001`，或结束占用 3000 的进程 |

## 二、日常使用须知

- **忘记密码**：登录页「忘记密码？」用邮箱验证码找回。演示模式（默认开启）验证码直接显示在页面上。
- **改密码 / 管理员重置成员密码**：登录后进「个人设置」修改；负责人/管理员可在成员管理里重置成员密码（生成一次性临时密码告知本人）。
- **数据备份**：本地环境数据在 Docker 卷 `pgdata` 与工作目录 `uploads/`；重要节点建议 `docker exec agilecampus-db pg_dump -U agilecampus agilecampus > backup.sql` 导出一份。
- **浏览器扩展**：图片下载类扩展会向页面注入属性并触发开发环境的 hydration 提示——演示或排查问题时使用无痕窗口。

## 三、上线前检查清单（生产部署逐项确认）

1. **环境变量**（服务器 `.env.local`，不进 Git）：
   - `DATABASE_URL`（生产库连接串）
   - `AUTH_ALLOWED_ORIGINS=https://实际访问地址`
   - `TRUST_PROXY_IP`（仅在 Nginx 覆盖 X-Real-IP 且应用端口不对公网时为 true）
   - `RESET_DEV_MODE=false`（**必须显式关闭演示验证码**，否则任何访问者可重置他人密码）
2. **HTTPS**：证书有效且匹配访问地址；生产拒绝 HTTP 登录（Secure Cookie）。
3. **数据库**：使用增量脚本（`npm run db:add-*`），不跑 `db:push` / `db:seed`；`npm run db:fix-chat-timezone -- --check` 确认聊天时间字段。
4. **上传目录**：`uploads/` 存在且应用用户有读写删除权限；磁盘余量充足。
5. **进程与代理**：单实例（systemd 或 PM2 二选一）；Nginx `client_max_body_size 105m`；3000/数据库端口不对公网。
6. **账号安全**：修改全部演示账号密码；删除/禁用文档中的示例账号；管理员账号不使用弱密码。
7. **备份**：发版前 `pg_dump` + uploads 打包，放在项目目录之外并验证可读。
8. **冒烟验收**：登录 → 建团队/项目 → 建任务拖状态 → 聊天/上传/撤回 → 私信 → 通知 → 退出重登。任一失败先停止，查 `journalctl -u 服务名`。

## 四、故障处理优先级

1. 先看应用日志（journalctl / dev 终端），再看 Nginx，最后看数据库（`pg_lsclusters`、连接数）。
2. POST 503 → `AUTH_ALLOWED_ORIGINS`；413 → 上传大小；403 → 来源或权限；登录后仍提示未登录 → HTTP 访问导致 Secure Cookie 失效。
3. 回退代码前先确认数据库结构兼容；恢复数据库必须与附件备份配套，单独恢复数据库不恢复磁盘文件。
