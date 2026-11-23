# 私聊 M0：数据、接口、迁移与测试设计

日期：2026-11-18。状态：M0 设计完成，尚未建表、迁移、实现接口或接入正式界面。依据 [需求](phase-2-requirements.md) REQ-23—38、DM-01—09 及 [已确认边界](phase-2-private-chat-design.md) Q1—Q23。用户已认可首版线框。以下技术选择由实现方维护，产品边界不变。

## 1. 现有工程接入结论

- 复用 `lib/auth.ts`、`requireUser`、现有 Cookie/Origin 防护。不能调用 `requireProjectAccess` 代替私聊参与者校验；平台/团队管理员无查看特权。
- `team_members` 是共同团队的权威来源，项目成员入口仅用于选择联系人。现有成员移除及团队删除使用团队行锁，私聊发送须遵循同一锁顺序并在事务内重新核对成员关系。
- 现有 `notifications` 是普通通知记录，`PUT all` 会批量标为已读。私聊未读不能存为一条普通通知或受此接口清空；在原通知 UI 加入单独的私聊聚合数据，旧普通通知接口保持原行为。
- 文档资源带团队归属，团队删除会清理；私聊图片不能直接使用 `document_resources`，否则违背离队/团队解散后历史保留要求。存储可共用持久磁盘根目录，但使用独立私聊子目录、表和鉴权响应。
- 首批采用不重叠的增量轮询，不先增加 WebSocket 部署依赖；前台展开约 2 秒，未展开约 10 秒，后台降低频率，失败指数退避至 30 秒，恢复前台立即补齐。间隔是可调整技术参数，不是实时送达时限承诺。任何请求需支持取消及过期响应丢弃。

## 2. 数据结构（计划 8 表）

主键使用 integer，时间 timestamptz；序列/版本 bigint 作为十进制字符串传 JSON。用户对排序 `user_low_id < user_high_id`，禁止给自己发起会话。用户删除不在本批范围，参与者外键 RESTRICT，不能经用户级联删除悄悄清空历史。

| 表 | 主要字段与约束 |
| --- | --- |
| dm_conversations | id、user_low_id、user_high_id、next_message_seq、revision、last_message_id、last_message_at、created_at；用户对 UNIQUE，两个用户 FK；不关联团队/项目 FK |
| dm_user_states | conversation_id/user_id 复合主键、muted、settings_version、created_at；必须为该会话双方之一，每会话两条。只向本人返回 muted，不保存草稿或“当前打开窗口” |
| dm_messages | id、conversation_id、message_seq、sender_id、client_message_id UUID、payload_hash、kind(text/image)、text NULL、image_id NULL、reply_to_message_id NULL、sent_at、revoked_at；UNIQUE(conversation_id,message_seq)、UNIQUE(sender_id,client_message_id)、UNIQUE(id,conversation_id) |
| dm_message_reads | message_id/user_id 复合主键、read_at；仅该消息接收者、仅正常消息可首次插入；不以“最大已读 ID”代替逐条已读，不回退已读 |
| dm_images | id、conversation_id、uploader_id、client_upload_id UUID、stored_name UNIQUE、mime_type、size、sha256、state(staged/ready/deleting)、created_at、orphan_after；唯一 uploader/client_upload_id，同键异内容冲突；图片与会话/上传者强绑定 |
| dm_events | conversation_id/event_seq 复合主键、kind、message_id NULL、created_at；event_seq 取会话 revision，在同一事务分配。只含变更类型及 ID，不存消息正文/引用摘要或图片路径 |
| dm_cleanup_jobs | image_id PK/FK、not_before、attempts、last_error、lease_until；图片实体清理重试队列 |
| dm_migrations | key PK、checksum、details、applied_at；独立记录本模块结构与约束，不改文档迁移台账 |

消息类型约束：正常 text 必有非空白文字、无图片；正常 image 只有图片、无文字；撤回后 text/image_id 均清空，保留类型、发送者、原发送时间、序号和被引用身份。撤回前资源 ID 由清理队列持有，不在客户端撤回 DTO 中暴露。

文字按 Unicode code point 计数（`Array.from` 与 PostgreSQL `char_length` 对齐），最多 5,000；组合 emoji 可能占多个字符，前端计数必须一致。保留换行，不因 trim 校验而裁掉正文有效空白。HTTP(S) 仅在渲染时安全识别，永不执行 HTML、自动请求外站或生成链接预览。

索引：消息 (conversation_id,message_seq DESC)；读取记录按 user_id/message_id；事件按 conversation_id/event_seq；待清理图片按 state/orphan_after。搜索先采用带字面量转义的大小写不敏感子串匹配，不启用 SQL 通配符/正则；性能数据证明需要时再增 pg_trgm，不把扩展安装设为首批前提。

## 3. 权限、锁与原子事务

### 会话建立与发送

发起会话：先验证共同团队；规范化用户对，INSERT ON CONFLICT 后读取同一会话，原子补齐双方状态。已有会话即使无共同团队仍可按参与者打开；未建会话且无共同团队不得建立。查询联系人仅返回与本人有共同团队的用户，不能成为全站用户目录。

发送、图片上传发布：查询候选共同团队 ID，按 ID 升序锁团队 FOR SHARE，再按 ID 锁双方用户、锁会话 FOR UPDATE，重新查询共同成员；与现有离队/团队删除的团队 FOR UPDATE 互斥。候选团队已消失则重新核对并拒绝或重新开始事务，不在会话锁后倒序补拿团队锁。发送与离队以锁获得的事务先后为准，不允许“校验通过后离队，仍写入新消息”的缝隙。

仅阅读/搜索/已读/撤回不要求共同团队，只要求为参与者。需要会话锁的这些操作不再申请团队锁，避免反向等待。正文日志不得记录消息内容、Cookie 或存储凭据。

### 顺序与幂等

会话锁内分配 message_seq，确认接收时间并插入消息、递增 revision、写入事件和最近消息字段后提交。列表顺序以 message_seq 为准，不依赖客户端时间或全局 serial 的提交先后。

同 sender/client_message_id 的 payload_hash 包含会话、类型、文字/图片身份及回复目标。重试相同内容返回原结果，不重复分配序号/未读；不同内容返回 REQUEST_CONFLICT。请求成功后失去共同团队时，可以查询本人既有请求结果，但不能借重试写入新消息。即使原消息已撤回，原请求身份仍保留，重试返回撤回结果而非重发。

客户端先持久保存发送编号及内容，再发请求；收到确认后才移出待发。超时归类“结果待确认”，通过本人请求状态接口核对。未命中只表示当前尚无已提交结果，不证明在途请求不会提交：不确定项只能继续核对或以同编号重试，不能立即删除待发记录。确定的拒绝且无在途请求才提供移除失败项。

### 引用与撤回

reply_to_message_id 与 conversation_id 复合 FK 保证同会话；目标必须已正常发送且序号更早，发送者可为任一方；不存嵌套内容或摘要快照。发送回复与撤回均锁会话，目标先撤回则发送以 REPLY_TARGET_REVOKED 拒绝，不自动降级为普通消息。

详情/列表/搜索通过原消息实时投影回复摘要。原消息撤回时清空正文及图片引用，保留占位；写撤回事件，使客户端清除原消息以及所有引用摘要/搜索/列表预览缓存，包括当前未载入的历史窗口。刷新、搜索及定位也重新核对，不靠缓存保留旧摘要。回复者自己的正文不变。

本人撤回以消息 ID 幂等，无时限且无共同团队也可撤回；另一参与者、管理员和第三方均不可代撤回。撤回不生成新未读；统计忽略撤回项。最近会话排序保留原发送时间，不因撤回或已读上浮。

### 图片

只接受实际可解码的 JPG/PNG/WebP，最大 10MiB；不信任扩展名或声明 MIME，拒绝 SVG/GIF、空文件及损坏伪装图片。像素/解码内存上限在实现前选择安全的运行库和固定限制，作为技术保护记录，不默默接受解压炸弹。入库前图片真实解码检查需纳入测试。

两阶段上传：登记 staged 图片及 24 小时清理任务→随机文件名写入私聊子目录→重新核对发送资格/归属后发布 ready。失败/中断保持可清理；相同上传编号/内容重试不重复发布。发消息绑定本人、同会话 ready 图片，一张上传资源最多绑定一条消息（同消息重试除外），禁止猜资源 ID 跨用户/会话引用。

图片 GET/HEAD 仅在会话参与者且存在未撤回消息绑定时可用；尚未发送的图片仅上传者预览。离队仍可读已发送图片，但不可发布新上传或新图片消息。响应 private/no-store、nosniff，无静态公开 URL。撤回后所有新读取/缓存校验均拒绝，浏览器已取得或对方已下载的字节无法收回。

清理锁图片后再查消息引用；暂存宽限 24 小时，撤回立即排队，物理失败重试。清理不在持图片锁时再反向拿会话锁；发送为会话→图片顺序，清理仅持图片锁与查询引用，发布必须再次验证资源未删除。团队/项目删除不得选入私聊图片。

## 4. 已读、列表、通知与同步

- 服务端未读真相：对方发出的正常消息，且不存在本人读取记录；总条数按此求和，会话数按有未读的会话计数。首批不把派生计数作为独立可漂移字段。
- 客户端只在可见标签页、展开对应窗口、实际可见消息时提交明确 messageIds，批量最多 100；IntersectionObserver 与窗口状态共同判断。只对传入的接收消息插入读取记录；客户端是可见性信号来源，服务端仍校验参与者、接收者和消息状态，不声称服务器能独立证明用户目视。
- 会话新开定位 firstUnreadMessageId，没有未读时尾页；读过后其他窗口更新对应状态，但不互相切联系人或窗口开关。
- 免打扰仅在本人状态表，版本 CAS 修改；对方 DTO 不含此设置。聚合未读仍包括免打扰会话，主动轻提示不包含正文，当前实际展开阅读的会话不重复提醒。已读或免打扰变化不改变最近发送排序。
- 同步采用每会话 revision/event_seq，不以全局 serial 事件 ID 做游标，避免跨事务晚提交被跳过。先取受限事件页，响应 cursor 只推进到实际返回最后项；若事件已清理则返回 resetRequired，客户端重新加载摘要、当前消息、可见历史及引用。
- 最近会话和聚合端点每轮重新读取当前用户可见的全部分页摘要，不通过“更新时间游标”推断未读变化。客户端以请求代次及联系人 ID 丢弃旧响应；追赶期间不标记未展示消息已读。
- 事件日志可保留 7 天，超期走全量重同步；正常消息及逐条已读记录不随事件一起删除。故障时不清理消息历史。

## 5. API 契约草案（供 M1 起实现）

前缀 `/api/private-chat`。均需登录、精确 Origin 校验（写操作）、参与者权限；内容响应 private/no-store。无权读会话/消息/图片统一 NOT_FOUND，不能通过猜 ID 探测内容。服务未迁移返回 MODULE_NOT_READY，不影响旧接口。

| 路径 | 方法 / 输入 | 输出与行为 |
| --- | --- | --- |
| `/contacts` | GET q?、cursor?、limit<=50 | 共同团队联系人，排除自己；不返回陌生用户 |
| `/conversations` | GET cursor?、limit<=50 | 按最后发送时间/ID 稳定分页，自己的 muted/unread/canSend；对方姓名回落学工号 |
| `/conversations` | POST peerUserId | 幂等打开唯一用户对；已存在可离队后重开，无历史且无共同团队拒绝 |
| `/summary` | GET | 总未读消息数、未读会话数；嵌入旧通知 UI，不受普通通知 all-read 控制 |
| `/conversations/[id]` | GET | 对方、canSend、限制原因、revision、firstUnreadMessageId、本人 settingsVersion/muted |
| `/conversations/[id]/messages` | GET before?/after?、limit<=50 | 按 message_seq 分页，禁止 before/after 混用；返回投影后的引用及已读状态 |
| `/conversations/[id]/messages` | POST clientMessageId、kind、text/imageId 二选一、replyToMessageId? | 单条原子接收；幂等冲突 409；返回确认的消息身份/顺序/时间 |
| `/requests/[clientMessageId]` | GET | 仅当前发送者自己的结果：accepted/revoked/notFound；notFound 不等于在途请求取消 |
| `/conversations/[id]/messages/[messageId]/context` | GET | 同会话定位窗口，前后各最多 25 条、分页游标；撤回目标仅占位 |
| `/conversations/[id]/search` | GET q（1—200）、cursor?、limit<=50 | 字面量连续子串，忽略大小写；排除撤回及图片；发送者/时间/匹配摘要 |
| `/conversations/[id]/read` | POST messageIds（1—100） | 幂等逐条标读，返回最新计数/revision，不自动扩展范围 |
| `/conversations/[id]/messages/[messageId]/revoke` | POST | 仅本人撤回；重复返回原撤回状态 |
| `/conversations/[id]/preferences` | PATCH muted、expectedSettingsVersion | CAS 更新本人设置，冲突后重读，不覆盖另一窗口新设置 |
| `/conversations/[id]/events` | GET afterRevision、limit<=100 | 消息/撤回/读取/状态变更 ID，nextRevision、hasMore/resetRequired；不内嵌正文 |
| `/conversations/[id]/images` | POST multipart file、clientUploadId | 返回 imageId 与受鉴权预览地址；同编号异内容冲突 |
| `/conversations/[id]/images/[imageId]` | GET/HEAD | 按参与者/发送绑定或上传者预览鉴权，无公开文件地址 |

Message DTO：id、conversationId、messageSeq、sender{id,name}、kind、text/image（正常时）、sentAt、revokedAt、readAt、reply（sourceMessageId/sender/摘要或 revoked）；不含存储路径、payload_hash、其他人的 clientMessageId 或未发送内容。图片摘要固定“[图片]”，引用摘要最多两行由 UI 截断，不复制图像。

错误码至少包含 AUTH_REQUIRED、NOT_FOUND、NO_COMMON_TEAM、REPLY_TARGET_REVOKED、REQUEST_CONFLICT、INVALID_INPUT、IMAGE_INVALID、IMAGE_TOO_LARGE、SETTINGS_CONFLICT、MODULE_NOT_READY、RETRY_LATER。拒绝发送保留本机文字；只在明确的产品状态改变时改变 UI，不将任何网络错误误判为离队。

## 6. 草稿与客户端发送队列

草稿键以账号、联系人、窗口身份隔离，每份保存 text、replyToMessageId、revision、updatedAt、writerId；另有索引供刷新恢复选择。storage/BroadcastChannel 广播只提示冲突，不直接替换当前输入。写前核对版本，冲突生成并列草稿，不能先覆盖再通知。无自动跨设备同步。

发送队列独立于输入草稿：提交一条消息时持久化 clientMessageId/payload/状态，再清编辑框供下一条；旧请求响应不能清除新输入。恢复时先查询不确定结果再重试。服务端已接收但响应丢失时只展示一条，按服务端实际顺序定位。

未发送图片只在当前页面内存持有，刷新需重选；若已发请求结果不确定，先查请求状态，再决定是否需要重选，不能给同一编号绑定另一张图片。退出清除该账号全部窗口草稿及待发本地内容，并通知其他窗口；不删除服务器消息。用户切换时旧账号状态立即从界面卸载。

## 7. 增量迁移与隔离演练计划

本阶段仅定方案，不执行 DB 写入。计划新增 `db/add-private-chat.ts`、独立 `db/private-chat-migrations/001-private-chat.sql` 与跨行保护 SQL；不重生成文档 001—005。新目录也需加入原字节保留属性。迁移检查准确数据库名和 SHA-256，在 advisory lock 下单事务安装；重跑不重复插入会话/消息，失败无成功标记。

M1 前另建本机 `agilecampus_test_private_chat_20261118`（自动测试）与 `agilecampus_test_private_chat_review_20261118`（浏览器），从基础结构准备合成数据，不复制真实账号或上传目录。独立文件根目录 `uploads-private-chat-review`，普通 `.env.local` 不改；不把本机数据或密码推送 Git。

演练：基础结构+文档现有版本→私聊增量→重跑→外键/用户对/消息类型/引用/逐条已读约束→失败回滚→团队删除仍保留私聊→备份至新隔离库恢复核对。仅执行新设计检查不能标为演练通过；真实备份必须同时包含私聊文件。

## 8. 测试边界与样例（计划，未执行）

按测试驱动开发逐条落地，不先写一批跳过或伪通过的测试。计划的公开测试边界为：真实认证 HTTP（权限、输入、幂等响应）；数据库约束/迁移（把数据库本身作为公开边界）；浏览器操作（可见性、草稿及交互）。这些边界在写可执行测试前整体确认。服务内部私有函数不作为测试目标。

固定样例：Alice/Bob 共同属于团队 A 和 B，Carol 是团队 A 的第三方管理员，Dave 属于无关团队 C。再准备两项目入口、无历史联系人、自引用/其他会话消息、真实/损坏图片、两个独立登录浏览器及同账号双标签页。每条测试说明其边界：HTTP 不证明浏览器真实可见，DB 不证明鉴权，浏览器不代替原子约束。

| 编号 | 测试情景与预期 | 对应 |
| --- | --- | --- |
| M0-T01 | 两个项目入口及并发建会话仅同一用户对一条；不能自己与自己建会话 | DM-01 |
| M0-T02 | Carol 即使为管理员也无法读双方正文/引用/图片/搜索/事件 | DM-01 |
| M0-T03 | 移出团队 A 仍因 B 可发送；失去 A/B 后禁发但可读/撤回本人；重新共同入队恢复 | DM-02 |
| M0-T04 | 团队/项目删除不级联删除会话、消息、图片或已读记录 | DM-02 |
| M0-T05 | 正常 5,000 code points 成功，5,001/纯空白拒绝；换行/emoji一致，HTML 不执行 | DM-03 |
| M0-T06 | 同编号同内容重试一次结果，同编号不同文字/会话/引用/图片冲突 | DM-03 |
| M0-T07 | 响应丢失后查状态，不重复发送；A 失败、B 成功、A 重试后顺序 B/A | DM-03 |
| M0-T08 | PNG/JPEG/WebP 实际解码、10MiB 边界、空/损坏/伪装/GIF/SVG拒绝 | DM-03 |
| M0-T09 | 图片上传崩溃排清理；跨上传者/会话猜资源 ID 不可绑定；匿名读取拒绝 | DM-01、03 |
| M0-T10 | 撤回保留时间/占位，正文与新图片请求不可读；对方/管理员撤回拒绝 | DM-04 |
| M0-T11 | 未读撤回减条数，最后一条撤回减少未读会话数，不新增撤回未读 | DM-04、07 |
| M0-T12 | 共同团队删除与发送并发以事务先后判定，不能半校验后漏写或串队 | DM-02 |
| M0-T13 | 搜索大小写忽略、%/_按字面量、跨分页定位；图片和撤回不命中 | DM-05 |
| M0-T14 | 只标明确可见 messageIds；跳到第 20 条不能顺带读第 1—19 条；重复/多窗口不重复计数 | DM-06 |
| M0-T15 | 后台/最小化/关闭/仅打开列表不已读；前台展开且可见才标读 | DM-06 |
| M0-T16 | 普通通知“全部已读”不清私聊；聚合条数/会话数及免打扰仍计数，轻提示无正文 | DM-07 |
| M0-T17 | muted 仅本人可改可见，跨浏览器生效；CAS 冲突不覆盖新设置，不影响最近排序 | DM-07 |
| M0-T18 | 文字/引用刷新恢复，图片需重选；两标签页冲突可比较选择，旧响应不清新草稿，退出跨窗口清除 | DM-08 |
| M0-T19 | 回复双方文字/链接/图片，同会话约束，只有一层摘要，可定位历史 | DM-09 |
| M0-T20 | 原文撤回使引用/搜索/列表缓存失效；回复正文保留；发送前原文撤回拒绝且输入保留 | DM-04、09 |
| M0-T21 | 收到事件按会话序号追赶，多页不跳过，日志过期重同步；网络异常保持草稿及准确错误状态 | DM-08 |
| M0-T22 | 清理与发布竞态不会发出已删除图片；撤回图片新请求立即拒绝，磁盘失败重试 | DM-04 |
| M0-T23 | 新迁移重跑/失败/校验和变更、隔离库备份恢复以及旧文档/任务/通知回归 | M5 |
| M0-T24 | 390/1024/1440 布局、日夜主题、输入法 Enter、历史滚动不跳底及首未读定位 | DM-08 |

## 9. 后续实施顺序与完成标准

1. 首条纵向链路：隔离迁移及认证→唯一会话→文字发送→双方分页读取/幂等重试；每一步先失败测试，再实现最小行为。
2. 接认可线框：成员入口、最近会话、单窗口/最小化/窄屏，补逐条已读及增量同步，不先以“全部已读”占位。
3. 图片生命周期、引用、撤回、搜索；随后聚合提醒、个人免打扰、草稿冲突/断网恢复。
4. 全量 DM-01—09、M0-T01—24 及旧功能回归、生产构建，另写私聊验收指南，人工验收与发布分开。

M0 本次交付为技术契约和测试计划。上述表、路由、测试编号均为待实现/执行，不能被文档索引或进度表标成已建表/已通过。首批新增引用及草稿多窗口处理带来实现成本，2026-11-25 原目标未通过本次设计重新评估；M1 打通后按剩余工作核对排期，不缩减权限或数据保护测试。
