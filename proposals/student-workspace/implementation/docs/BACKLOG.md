# 技术债备案（作战图一审查沉淀）

内部试用可接受、市场化/正式上线前须重审的取舍：

## 安全/认证
- JWT 会话无显式失效机制，默认 30 天 maxAge——改密码后旧 token 仍有效；正式上线前设短 maxAge 或引入会话版本号
- authorize 对不存在用户不跑 bcrypt（时序侧信道可枚举邮箱）——如需弭平，对不存在用户跑固定 hash 的 compare 占位
- 最后一名 admin 可被降级/自降导致团队无管理员——lib 层补"末位 admin 不可降级"不变量
- 成员管理页对全体成员展示所有人邮箱——确认隐私合规或限 admin 可见

## 产品
- 邀请码 nanoid(10) 混大小写含 -/_，口头/板书传播不友好——可换大写字母+数字自定义字母表（去 0/O/1/I/L）
- 邀请码对全体成员明文展示——考虑仅 admin 可见
- createTeam 邀请码唯一键碰撞（概率 64^-10）无重试兜底

## 工程
- docker-compose 硬编码凭证与 .env 双源无关联机制——改 env_file/变量插值统一来源
- docker-compose 无 healthcheck——引入 depends_on 服务前补
- 团队列表查询直写在 page.tsx——再有同类需求时上提 lib 层 listMyTeams
- bcryptjs 自带类型声明，@types/bcryptjs 冗余可移除
- SALT_ROUNDS=10 为下限，可评估升 12

## 图二（骨架）简化备案
- 无项目级成员表：团队成员即可见全部团队项目（"参与的项目"从宽）
- 看板列内手动排序未做（sort_order 已建，拖拽仅改状态）
- teacher 反馈/评论功能后置（设计文档原定 MVP 后）
- 里程碑无编辑/关闭入口（仅创建与展示，状态字段已建）
- 项目无编辑/归档入口（status 字段已建）
- updateTask/deleteTask "任务不存在"先于权限返回，对非成员泄露 uuid 存在性（uuid 不可枚举，风险极低）

## 图三上（对话地基）简化备案
- 对话采请求-响应式（generateText 非流式），真流式（useChat + toUIMessageStreamResponse）后置——无密钥时流式无从离线验证
- 每项目一活跃会话（getOrCreateConversation 取最近一条），未做多会话/会话列表
- tool role 消息未独立成行：工具轨迹并入 assistant 消息的 toolCalls jsonb
- DeepSeek 真实调用未演武（离线打通策），密钥齐备后须补真实一轮问答验收
- 快照上限固定 2000 字符、超限整体降级为统计头，未做分段精细裁剪
- 工具执行走底层 lib 各自的权限校验，与编排入口 getProjectForUser 构成轻微重复查询（复用现成 lib，未优化）

## 依赖版本教训（图三上 Task 6 沉淀）
- **AI SDK provider spec 版本须对齐**：`ai@5` 依赖 `@ai-sdk/provider@2`（LanguageModelV2），`generateText` 按 `specificationVersion === "v2"` 分派；`@ai-sdk/openai-compatible@3` 却依赖 provider@4（V4），既过不了 tsc，生产 getModel 亦运行时不匹配。正解锁 `@ai-sdk/openai-compatible@^1.0.46`（依赖 provider@2），使全树 provider dedupe 至单一 2.0.3。日后若升 `ai` 至 v6/provider V4，openai-compatible 须同步回 @3。
- `ai/test` 的 `MockLanguageModelV2` 数组形式 `doGenerate: [...]` 在 5.0.218 下按 `doGenerateCalls.length`（push 后）取值，等效 1-indexed 跳过 [0]；多轮 replay 须用函数游标形式 `doGenerate: async () => script[cursor++]`。
- `ai/test` 静态 import `msw`（provider-utils 的声明依赖但未随装），须显式补 `msw` devDependency 方可离线用 mock。

## 图三下（四写兵器）简化备案
- plan_sprint 免版本校验（草案仅 taskIds 无逐任务 updatedAt）——批量归里程碑+设截止日，低冲突，MVP 可接受
- update_tasks 乐观锁比对 updatedAt.toISOString()；同一毫秒两写理论上仍可能漏检，概率极低
- update_tasks 同批次若含同一任务两条变更，versionOf 为循环前快照，第二条仍可能通过（边缘场景，MVP 不处理）
- 草案不入库持久化：仅随 assistant 消息 toolCalls 留痕 + 前端态；页面刷新后未落库的草案卡片消失（需重新对话）
- 确认卡片可编辑聚焦核心字段：update_tasks 卡仅展示 patch（不可逐字段改）
- DeepSeek 真实「拆任务→确认→落库」演武待密钥
- ~~**批量落库非事务**（总审沉淀）：commitDraft 的 decompose/update/plan_sprint 循环无 db.transaction，中途第 k 项抛错则前 k 项已落库、请求返错、用户重试致重复；市场化前须事务化（须图二 createTask/updateTask 接受 tx 参数）~~ **[已偿·图七]** createTask/updateTask 收 tx，三分支裹 db.transaction，通知事务提交后补发
- update_tasks 中不属本项目的 taskId 被误报为"版本冲突/他人改动"（实为无效 id）——纯提示文案，无安全影响

## 图四（任务增强+总览）简化备案
- 后置任务仅防直接成环（A↔B），未做间接环（A→B→C→A）检测——简单关联，不强制阻断执行
- 完成情况(completionNote)仅编辑态填写，未做「拖入已完成时弹窗提示补充」的引导交互
- 跨项目总览为列表+任务统计，未含管理员整体看板泳道/甘特图（留后续「图五·管理视图」）
- listMyProjects 对 admin/teacher/student 一视同仁（无项目级成员表，沿图二备案）
- 后置任务多选下拉在任务多时体验一般（原生 select multiple），未做更友好的选择器

## 图五（API Token + 资源占用 + CC 写入）简化备案
- token 作用域=该用户全部权限（MVP），未做限定项目的细粒度作用域（留后续）
- token 无过期机制，仅撤销即失效；未做自动过期/轮换
- verifyApiToken 每次校验命中即写 lastUsedAt（每请求一次写），未做节流/批量
- listApiTokens 含已撤销令牌供 UI 标注状态，撤销记录不清理会累积（无软删清理任务）
- 资源名自由填写，无预定义资源池/资源实体表——同名字符串即同一资源（大小写/空格敏感）
- 时长汇总仅计已结束占用；进行中占用不计入 byUser/byResource（避免 now 引入的不确定性）
- endResourceUsage 权限=登记者本人 or 团队 admin；teacher/其他成员不可结束他人占用
- /api/agent/* 无速率限制，防滥用（限流）后置
- resource-usage 端点时间用 z.coerce.date()，时区取决于调用方传入的 ISO 串；网页表单用 datetime-local（本地墙钟）
- ~~CC 仅「写入」（加任务/填完成/登记资源），未做「读」端点（查进度/列任务）——陛下所命~~ **[已偿·图八]** 补五道读端点：`GET /projects`、`GET /projects/{id}`、`GET /projects/{id}/tasks`、`GET /tasks/{id}`、`GET /tasks/{id}/subtasks`
- CC skill 需用户手动配置 AGILECAMPUS_TOKEN/AGILECAMPUS_URL 环境变量；skill 未自动发现 project/team 的 uuid（需用户提供或从地址栏取）
- 尚未攻取：C 实验时间线视图、E 飞书接入（须陛下先备飞书 AppID/Secret）

## 图六·C（实验时间线甘特）简化备案
- 任务加 startDate（可空 date）；时间线取 [startDate?, dueDate?]：仅一端有值时以该端为准，单日任务补 1 天宽度
- 甘特纯 server 端渲染 + CSS 百分比定位，无缩放/拖拽/横向滚动（长跨度项目条会很细）——只读查勘视图
- 时间范围强制纳入「今日」，全部任务在远期时图会被今日拉长（现实数据近期，可接受）
- 逾期判定=status≠done 且 dueDate<今日；未设 dueDate 的任务不判逾期
- 里程碑分组按 listProjectMilestones 顺序 + 末尾「无里程碑」；未排期任务单列徽章展示，不入甘特
- 时间线为项目级；跨项目/团队总甘特未做（留后续管理视图）
- startDate 未校验 ≤ dueDate（前端可倒填）；甘特对 start>end 做防御性纠正，但 lib 未强约束
- 时间线视图只读，未做在甘特上直接拖拽改期

## 图七（飞书接入）简化备案
- cron 端点无「当日已发」去重——逾期任务每日一提醒，靠外部调度每日一击天然节流；同日重跑会重复发
- 日报仅按 assignee 聚合；未指派的临期/逾期任务无人可提醒（不发）
- 完成通知仅发创建者一人；admin/teacher 全局视角后置
- 飞书消息用纯文本，未做交互卡片（含「查看任务」跳转按钮）——富卡片后置
- OAuth `state` 存 cookie 即可，未引入服务端 state 存储/一次性消费
- token 缓存为进程内存——多实例各自缓存（各自换取，飞书侧允许）；未做共享缓存
- 未做飞书事件订阅（用户在飞书内退订/停用应用的回调）——绑定后飞书号失效时发送失败仅记日志
- `scanAndNotifyDue` 全库扫描——任务量大时未分页/分批；当前规模可接受
- update_tasks 批量确认仅补发完成通知，未补发改派通知（改派走网页/CC 即时路径）
- 真机飞书 OAuth 绑定验收（Task 6）须备妥凭证亲验，离线不可代

## 图八（AI 修复 + 项目管理 API + 子任务）简化备案

### 本役沉淀（教训）
- **DeepSeek 番号已改制**：`deepseek-chat` 遭废弃，今只认 `deepseek-v4-pro` / `deepseek-v4-flash`，误用返 400 `invalid_request_error`。此即「对话失败，请重试」500 之真因（APICallError 非 AppError，落入通用分支）。现取 `DEEPSEEK_MODEL` 环境变量，缺省 `deepseek-v4-flash`。**日后模型番号务必置于配置，勿硬编码。**
- **快照缺 id 则写工具形同虚设**：旧快照只给成员名与里程碑标题，不给 uuid，模型遂无从填 `assigneeId`/`milestoneId`，指派与排期必空。今补 `id=` 于成员/里程碑/任务三段，并补「今天是 YYYY-MM-DD」——缺此则相对日期（「下周五」）必错。
- **模型会「演」草案而不调工具**：DeepSeek 曾口称「已拟好变更草案」而 `drafts` 实为空，界面一片空白。prompt 须显式声明「只有真正调用工具才会生成草案卡片，你写的文字不会变成草案」方止此弊。
- **模型过度盘问亦是缺陷**：仅告以「信息不足先问清楚」，模型对「帮我建个完成ai的任务」一味追问。须以实例立法（示以具体输入与应有动作）方肯动手。prompt 中一则范例胜过三条抽象规矩。

### 简化取舍
- 子任务仅一层语义（`parent_task_id` 自引用），API 只列**直接子级**不递归；深层树形与「展开全部子孙」后置
- **既有看板/甘特/统计视图未识子任务**——子任务作为普通任务平铺显示，父任务统计不含子任务汇总。UI 层级呈现留待陛下定夺
- `updateTask` 未开放改 `parentTaskId`（故无成环之虞，亦无须环检测）；如日后开放，须补环检测
- AI 写工具（`decompose_tasks`）未支持 `parentTaskId`——AI 拆出的任务一律为顶层
- `POST /api/agent/tasks`（body 传 projectId）与 `POST /api/agent/projects/{id}/tasks`（路径传）并存，功能重叠；保留旧约以免折损在用之 skill
- `create_milestone` 落库需 admin（沿 `createMilestone` 口径），student 拟出草案却点不动「确认落库」——提示文案未作角色预判
- `GET /projects/{id}/tasks` 之筛选在应用层做（取全量再 filter），未下推 SQL；当前规模可接受
- `getTaskDetail`/`listSubtasks` 沿旧口径，「任务不存在」先于权限返回（uuid 不可枚举，风险极低）
- 真实模型演武置于 `tests/agent-live.test.ts`，以 `describe.skipIf(!process.env.DEEPSEEK_API_KEY)` 自守——`.env.test` 无此变量，故 `npm test` 自动跳过、不耗额度。真打跑法：
  `export DEEPSEEK_API_KEY=sk-xxx && npx dotenv -e .env.test -- npx vitest run tests/agent-live.test.ts`
  （注：vitest 4 已无 `--include` 旗号，勿用）
- `tests/agent-drafts.test.ts` 在全量并行下偶发 5s 超时（单跑 852ms 即捷）——共享测试库之粮道拥塞，未调 `testTimeout`
