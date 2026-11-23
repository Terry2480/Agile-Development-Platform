# 文档系统技术设计基线

> 2026-11-15 状态更新：本批文档功能已在隔离版完成开发，数据库增量至 005（22 张文档表），当前组织组员人工验收，生产未发布。本文保留原确认/设计记录；当前实现、验证结果及验收步骤分别见 [交付记录](document-delivery-progress.md)、[验收指南](document-system-acceptance.md)、[部署说明](document-system-release.md)。


状态：本批结构、服务/API、导出及清理任务已在隔离环境实现并验证。产品规则以 [设计决策 Q1—59](phase-2-document-design.md) 为准，Q56 暂缓；运行与切换流程见部署说明，实际检查见交付记录。接口字段以 `lib/documents/validation.ts`、`types.ts` 及路由实现为依据，本文保留关键约定供协作查阅。

## 1. 数据类型和共同约定

- 新主键沿用 serial/integer，时间统一 timestamptz，日期展示用用户时区；乐观版本 bigint 以十进制字符串通过 JSON 传输，避免 JS 精度损失。资源 size 为 bigint，也以字符串返回。
- 所有节点保存 created_at/updated_at、created_by/updated_by。用户外键删除设 NULL，历史归因另保留操作时显示名；用户删除功能不在本轮新增。
- JSONB 正文根为 `{type:"doc",content:[...]}`，格式版本由正文/历史表的 `format_version` 保存；图片仅使用 resourceId、alt、展示尺寸；服务端逐节点校验和大小校验，禁止任意 HTML、外部图片加载及可执行链接。
- 正文上限按规范化正文 UTF-8 JSON 大小 5MiB；正文图片沿用仓库二进制 MB 计量方式，落实为 10MiB 并明确 UI 文案。普通文件 100MiB，导出内容 500MiB。实现和测试统一以字节常量判断。
- name 展示值先 trim；normalized_name 再对 ASCII A—Z 转小写，与数据库同一表达式保持一致；不额外合并中文全半角或改变用户 Unicode 名称。名称 1—200 个 Unicode 字符，禁止控制符及斜杠/反斜杠，避免目录导出路径歧义；导出另防止路径穿越。

## 2. 物理表与关键约束

### 2.1 空间与目录

`document_spaces`：id、team_id NOT NULL、project_id NULL、state（active/archived/deleting）、version、template_set（none/general/software）、created_at。project_id 非空唯一，project_id 为空时 team_id 部分唯一。项目空间采用 project_id/team_id 组合关系校验，项目与空间状态在同一事务修改，不由前端分别维护。

`document_nodes`：id、space_id、parent_id NULL、kind（folder/document/file/link）、name、normalized_name、system_role NULL（recovery）、state（active/trashed/purging）、version、created_at/updated_at、created_by/updated_by、trash_batch_id NULL、deleted_at NULL、expires_at NULL。

- 建 UNIQUE(id,space_id)，父级使用 (parent_id,space_id) 复合外键，删除行为 RESTRICT；只允许 folder 作为父级，通过服务事务与约束触发器验证，根层必须 folder。
- 活动节点建立两个唯一索引：根层 (space_id,normalized_name)，非根层 (space_id,parent_id,normalized_name)，避免 NULL 使顶层重名漏检。
- active 的 recovery 标识按 space_id 部分唯一，且只能位于根层；移为子目录时原子清除标识。系统标识不依赖名称。
- 同空间结构变更持有空间行锁；递归查询禁止循环，并核验至少一个正常分区。跨空间按空间 ID 排序加锁并更新整个子树的 space_id，不只更新根节点。
- expired 是 expires_at <= 服务端当前时间的派生状态，不额外持久化而产生双重真相。trashed 必须有 batch、deleted_at 和 expires_at，active 必须清空这三项。

### 2.2 当前内容、历史与锁

`document_bodies`：node_id PK/FK、format_version、content_json、body_revision、content_hash、last_checkpoint_at、updated_by、updated_at。

`document_versions`：id、node_id FK、format_version、content_json、content_hash、source_revision、body_author_id、body_author_name、created_by、reason、created_at。索引 (node_id,created_at DESC,id DESC)。不用全局 hash 唯一约束，允许旧内容后来再次成为恢复点。

`document_edit_locks`：node_id PK/FK、user_id FK、session_token_hash、acquired_at、expires_at。凭证使用随机值，客户端只在当前编辑窗口内存保存，不跨标签页共用；数据库仅存哈希。服务端事务锁定节点和锁记录后决定获取/续期，过期不能通过续期复活，只能重新申请。

- 内容表类型与节点 kind 由延迟约束触发器保证：document 恰有正文，file 恰有文件条目，link 恰有链接条目，folder 没有这三种内容。
- 正文与元数据版本分开；仅改标题递增 node.version，不生成正文历史。正文改变递增 body_revision，同时更新节点最近修改信息但不伪造正文历史作者。
- 开始编辑：原子获取锁并保护当前正文；成功保存后最近历史相同则去重。10 分钟恢复点由服务端按 last_checkpoint_at、正文变化判定，在保存或心跳处理时生成；后台编辑没有正文变化时不新增快照。
- 手动保存版本、恢复及草稿覆盖都串行持锁，先保存/保护再裁剪，最多保留 10 份；历史资源引用与快照同事务维护。

### 2.3 文件、链接和资源引用

`document_resources`：id、team_id、stored_name UNIQUE、original_name、mime_type、size、state（staged/ready/deleting）、created_by、created_at、staged_for_node_id NULL、orphan_not_before。实体不可变，stored_name 由服务端生成。

`document_file_entries`：node_id PK/FK、resource_id FK RESTRICT。当前文件资源的权威连接在此表。

`document_link_entries`：node_id PK/FK、url，校验 HTTP/HTTPS。变更通过节点 version CAS，日志保存操作事实，不提供可恢复 URL 历史。

`document_resource_refs`：id、resource_id FK RESTRICT、node_id NULL FK、version_id NULL FK、export_item_id NULL FK、role（file/body_image/version_image/export）、created_at。

- CHECK 三种 owner 恰好一个非空，role 与 owner/节点类型匹配；分别建立 owner/resource/role 部分唯一索引。避免无外键的 owner_type/owner_id 多态引用。
- 当前文件条目连接与 role=file 引用同事务更新，正文图片集合从规范化 JSON 计算，同事务增删引用；用延迟校验防止条目指向资源却缺少引用。
- 回收站保留正文、历史和文件引用，不另复制资源；永久删除先删除内容和引用，队列随后评估资源。固定正文图片引用不依赖源条目存续。
- 新正文图片上传只有待确认资源，绑定具体文档，允许持锁编辑器预览；保存正文时转成正式引用。选择已有图片也创建该文档的待确认授权，不允许任意提交 resourceId 引用别的项目资源。
- 未引用图片从上传/待确认授权建立起有 24 小时宽限；仍有有效编辑锁则延期。清理持资源锁，重新检查所有有效引用和待确认授权，不扫描删除未知磁盘文件。
- 下载使用当前资料上下文鉴权；历史图片额外验证 version_id 属于当前文档。支持 HEAD/Range，服务端流式读取；底层 URL 不公开。

### 2.4 业务关联与旧地址

`document_associations`：id、node_id FK、task_id NULL FK、milestone_id NULL FK、created_by、created_at。CHECK task/milestone 恰好一个非空，分别 UNIQUE(node_id,task_id) 和 UNIQUE(node_id,milestone_id) 部分索引。

关联操作锁定目标项目/空间，验证同团队及本项目或公共区，拒绝 trashed/expired 和归档目标。相同关联重试返回原结果；解除关联不改变正文或实体文件。

`document_legacy_files`：legacy_attachment_id PK（独立整数，不依赖旧行继续存在）、node_id FK UNIQUE。保留迁移前旧 URL 的永久身份映射；不把 legacy_attachment_id 放在会被旧级联删除约束拖走的结构上。

- 新关联为迁移后的权威来源；旧接口经适配器读取/写入新关联，不能继续独立修改旧 attachment.task_id 与 milestone_resources 而漏写新模型。
- 旧附件元数据暂保留兼容，不作为新清理的有效引用权威。旧 URL 先查映射，按新条目位置和权限返回当前文件；项目删除转存后映射仍在。

`document_operations`：node_id、actor_id、action（file.replaced/link.updated）、detail、created_at。保存替换/网址修改的元数据审计，不保存可恢复的旧二进制或网址版本。该表由增量 005 新增，随资料永久删除级联清理。

### 2.5 删除批次和恢复位置

`document_trash_batches`：id、space_id、root_node_id、deleted_by、deleted_at、expires_at。

`document_trash_items`：batch_id FK、node_id FK UNIQUE、original_parent_id NULL（历史位置编号，不设会阻止父目录永久删除的 FK）、original_path JSONB、original_space_id、original_name。

- 整体删除时仅收集当前活动子树，批次和成员同事务写入；之前已独立回收的内容不改期限。恢复以 batch 成员为准，单项恢复后移除对应 membership，避免整体恢复重复生成。
- 单项子文件夹恢复其本批次子树，不拉回其他已恢复条目；父级可用则原位，否则恢复分区；统一处理重名。
- 项目删除把正常和回收节点、批次及历史位置映射一起转入公共区，维持 node ID 和剩余期限，创建归档分区后完成空间变更再删项目。不得先删项目再试图挽救级联资料。
- 30 天按 timestamptz 精确间隔计算；到期后只返回可见清理状态，不返回内容。用户主动永久删除需显式确认及 owner/admin 权限。

### 2.6 导出、幂等与维护

`document_exports`：id、team_id、space_id、requested_by、state（queued/running/partial/completed/failed/cancelled/expired）、format、snapshot_at、expires_at、request_id、lease_until、attempts、artifact_name、failure_manifest、snapshot_metadata、created_at/updated_at。

`document_export_items`：id、export_id FK、node_id（快照来源编号）、relative_path、kind、snapshot_name、snapshot_body JSONB NULL、snapshot_url NULL、resource_id NULL、state、error_code、output_size。保存正文/路径快照而非只存 node ID；资源由 export_item 引用保护。任务认领使用 FOR UPDATE SKIP LOCKED 与租约，进程重启可重试，不重复发布最终包。

`document_requests`：id、user_id、operation、request_id、payload_hash、state、result_json、created_at、expires_at，UNIQUE(user_id,operation,request_id)。同键不同 payload 返回冲突；未完成可重试，不能提前返回成功。上传 requestId 贯穿暂存与结果发布，防止超时重复资料。

`document_cleanup_jobs`：resource_id UNIQUE、not_before、attempts、last_error、lease_until。处理前持锁重查引用，失败退避。导出产物使用独立临时存储路径，只能由所属任务下载，不混成用户目录条目。

导出限制按最终渲染的未压缩输出累计，包括实际写入图片和文件；500 条限制不计文件夹。超过上限停止并明确标记失败，不能自动将超限部分伪装成完整成功。部分下载仅适用于明确列出失败项的 partial 任务。24 小时从创建快照起算，重试不延长期限。每次下载检查快照所有来源资料的当前可读性；过期/已永久清理/无权则拒绝整个包并要求重新导出。任务创建者及当前团队权限共同校验，不通过任务 ID 授权其他成员下载。

## 3. 当前 API 契约

参数由 Zod 验证；列表 `parentId/q/cursor/limit/sort/foldersOnly` 严格解析，limit 默认 50、最大 100。列表按稳定排序键与 ID 使用游标，树按层加载；搜索仅在当前空间。节点及详情类型以 `lib/documents/types.ts` 为准。

```ts
type NodeDto = {
  id: number; spaceId: number; parentId: number | null;
  kind: "folder" | "document" | "file" | "link";
  name: string; version: string; fileMimeType?: string | null;
  updatedAt: string; updatedBy: { id: number | null; name: string };
  childCount: number; childFolderCount: number; associationCount: number;
  permissions: { read: boolean; write: boolean; rename: boolean; move: boolean };
  editLock: { editorId: number; editorName: string; expiresAt: string } | null;
};
```

权限字段只是 UI 指引，服务端重新校验。列表不返回正文或锁凭证；详情按需提供 body/url/file、associations、operations 及 trashed 标记。文件大小和修订号以十进制字符串传输。错误为 `{error,code}`，沿用客户端读取 error 的兼容行为。

| 路径 | 方法与用途 | 核心输入 |
| --- | --- | --- |
| `/api/projects/[id]/document-space`、`/api/teams/[id]/document-space` | GET 打开/初始化空间 | 路径中的项目/团队 ID，服务端校验成员身份 |
| `/api/document-spaces/[id]/nodes` | GET 列表；POST 建目录/文档/链接 | requestId、parentId、kind、name；文档 templateKey 可选，链接需 url |
| `/api/document-nodes/[id]` | GET 详情；PATCH 改名 | expectedVersion、name |
| `/api/document-nodes/[id]/move`、`/copy` | POST 移动/复制 | requestId、expectedVersion、targetSpaceId、targetParentId |
| `/api/document-nodes/[id]/editor` | POST 获取/续期/释放锁、保存、手动版本或恢复 | action；lockToken；保存需 name/content/expectedBodyRevision/expectedNodeVersion/requestId |
| `/api/document-nodes/[id]/versions`、`/versions/[versionId]` | GET 历史列表/具体正文 | 对应节点/版本 ID |
| `/api/document-nodes/[id]/versions/[versionId]/restore` | POST 恢复历史正文 | lockToken、expectedBodyRevision、expectedNodeVersion、requestId |
| `/api/document-nodes/[id]/images` | POST 内部图片；PATCH 已有图片授权 | multipart file/lockToken/requestId，或 lockToken + sourceNodeId/resourceId 二选一 |
| `/api/document-nodes/[id]/images/[resourceId]` | GET/HEAD 鉴权图片 | 可选 versionId、trash；不提供公开资源 URL |
| `/api/document-spaces/[id]/uploads` | POST 上传 | multipart file、parentId、requestId；可选 taskId/milestoneId 自动关联本项目对象 |
| `/api/document-nodes/[id]/file` | GET/HEAD 预览/下载、单区间 Range | 可选 preview=1、trash=1 |
| `/api/document-nodes/[id]/replace` | POST 替换文件 | multipart file、expectedVersion、expectedResourceId、expectedAssociations、confirmImpact=true、requestId |
| `/api/document-nodes/[id]/link` | PATCH 标题及网址 | name、url、expectedVersion、expectedAssociations、confirmImpact=true、requestId |
| `/api/tasks/[id]/document-associations`、`/api/milestones/[id]/document-associations` | GET 关联；POST 增删 | action=add/remove、nodeIds（1—100）、expectedVersion、requestId |
| `/api/document-nodes/[id]/impact` | GET 删除影响 | 返回数量、版本、编辑占用、关联 |
| `/api/document-nodes/[id]/trash` | POST 移入回收站 | expectedVersion、expectedCount、confirmScope=true、requestId |
| `/api/document-spaces/[id]/trash` | GET 回收站 | 可选 cursor，返回当前空间和 canPurge |
| `/api/document-nodes/[id]/restore`、`/purge` | POST 恢复/永久删除 | expectedVersion、requestId；purge 额外 confirmPermanent=true |
| `/api/document-spaces/[id]/templates` | PATCH 模板推荐 | templateSet、expectedVersion |
| `/api/document-spaces/[id]/exports` | GET 导出任务；POST 创建快照 | rootId（null 表示空间）、format=pdf/markdown、requestId |
| `/api/document-exports/[id]/retry`、`/file` | POST 重试原快照；GET/HEAD 下载 | 重试不延长有效期；下载重新核对发起者与所有来源权限 |
| `/api/projects/[id]/deletion-impact`、`/api/teams/[id]/deletion-impact` | GET 生命周期影响 | 正常/回收数量、编辑者、项目数量、转存目录 |
| `/api/projects/[id]`、`/api/teams/[id]` | DELETE 转存项目/解散团队 | confirmPermanent=true、expectedActive、expectedTrashed，执行时重核权限及数量 |
| `/api/document-status` | GET 当前库切换状态 | 返回 enabled，不代替具体资料访问权限 |

客户端在每次编辑会话用安全随机数生成 64 位十六进制 lockToken，申请锁时发送，后续请求沿用；服务器只保存 hash，并校验账号、会话、到期时间。获取成功返回 content、bodyRevision、nodeVersion、name、expiresAt、savedAt，不通过用户 ID 直接授予另一窗口写权。

保存请求用 requestId 幂等，响应丢失后重试同 ID 返回已提交结果；同 ID 不同内容冲突。标题与正文同事务提交，名称或修订冲突时整次失败，草稿保留。批量关联全部通过才提交；编辑历史恢复与回收站恢复是不同路径。

旧 `/api/files/[id]` 经 legacy 映射读取当前条目；旧项目上传入口要求目录并交给新服务。旧里程碑成果写入口在 cutover 后提示使用统一关联接口，不再独立维护第二套关联。

## 4. 迁移与旧清理机制切换

`db/add-file-cleanup.ts` 安装旧附件删除队列；当前 `lib/file-cleanup.ts` 已增加纳管资源交接，遇 `document_resources` 转入新引用感知队列，不按旧附件记录判断后直接删除。部署仍须先保证兼容清理代码到位，不能让旧版本 worker 与新资源写入混用。

执行顺序：

1. 在隔离数据库备份/演练，记录附件 ID、路径、大小、任务与里程碑引用计数；不使用 seed 覆盖旧库。
2. 建新结构，发布兼容清理：旧队列遇到已映射 stored_name 必须转交新引用检查；未映射旧文件仍走旧逻辑。项目/团队删除入口先受兼容保护，禁止绕过转存。
3. 固定旧附件迁移边界、逐条幂等回填资源/节点/映射/引用/关联，不复制实体；每项目历史分区用迁移身份映射，不能重复建或依显示名寻找。
4. 完整核对后切换新文件/关联写入到新模型，旧 API 全部经适配器。项目和团队删除同时启用新流程，不能只更新前端按钮。
5. 回归旧 URL、成员离队、任务/里程碑删除、替换、共享资源清理、项目转存后下载。兼容期保留旧行，但不将其作为可独立写入的业务真相。
6. 记录迁移完成标识与回退门槛。产生新副本/替换/转存后不允许直接回退旧 worker 和旧删除实现；保留兼容版本或成套恢复备份。

## 5. 模块组织与测试责任

当前实现放 `lib/documents/`：`service.ts` 处理资料/正文/锁/历史/关联/回收及快照，`lifecycle.ts` 处理项目转存和团队删除，`legacy.ts` 兼容旧入口，`files.ts`/`file-response.ts` 负责文件识别/响应，`export-worker.ts` 与 `maintenance.ts` 处理后台任务，`validation.ts`/`body.ts`/`types.ts` 维护契约。API 负责解析、调用与响应；界面封装于 `components/ws/documents/`。

数据库相关测试只连接显式隔离库，按两团队三账号增加真实事务样例；图片用临时目录。每个约束至少覆盖正常与拒绝路径，重点如下：

| 工作包 | 必须验证 |
| --- | --- |
| 数据/目录 | 类型与内容一致、根层重名、循环、跨团队、最后分区并发删除、整目录原子复制 |
| 编辑/历史 | 同账号双窗口、心跳超时、响应丢失重试、标题冲突、手动和定时去重、恢复前保护、10 份裁剪 |
| 资源/回收 | 同资源副本替换隔离、历史图片保留、待确认图片鉴权、30 天边界、单项恢复后整体恢复、清理与保存竞态 |
| 生命周期 | 编辑与归档互斥、项目删除转存含回收站、旧 URL 仍有效、旧队列不误删、团队删除取消导出 |
| 导出 | 快照一致、部分结果、同快照重试、500 条/500MiB、24 小时、失权拒绝整个包、Range/中断清理 |

已落地 22 张文档物理表及增量 001—005，结构、服务和后台任务分别完成隔离检查，具体结果见交付记录。普通技术细节按实现维护，新增产品范围或权限变化仍须单独记录。
