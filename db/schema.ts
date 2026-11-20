import {
  pgTable, serial, text, timestamp, integer, boolean, date, unique, index, check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============ 用户与会话（v1 已有，保持不变） ============ */

// 用户表：登录账号 + 个人资料（名称、学工号、性别、地区、个人简介）
// 高校场景：学工号唯一、注册必填；名称（展示名）可不填，避免强制实名与重名困扰
// role 字段为平台级角色预留（member / admin），团队内角色见 teamMembers.role
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),           // 登录账号
  passwordHash: text("password_hash").notNull(),     // 密码哈希（scrypt，不存明文）
  name: text("name"),                                // 名称：展示用昵称，可不填（未填时显示学工号）
  studentId: text("student_id").notNull().unique(),  // 学工号：注册时必填的唯一标识
  gender: text("gender"),                            // 性别：男 / 女 / 保密
  region: text("region"),                            // 地区
  bio: text("bio"),                                  // 个人简介
  role: text("role").notNull().default("member"),    // 平台级角色（预留）
  createdAt: timestamp("created_at").defaultNow(),
});

// 会话表：登录成功后签发一条会话记录，退出时删除
// expiresAt / lastActiveAt 保存 UTC；每次鉴权更新活跃时间（节流 1 分钟）
export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),                 // 随机令牌（放在 httpOnly Cookie 里）
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  lastActiveAt: timestamp("last_active_at"),         // 最近活跃时间（5 分钟内视为在线）
  createdAt: timestamp("created_at").defaultNow(),
});

// 密码找回验证码表：忘记密码时生成一次性 6 位验证码，仅有效期内可重置密码
// codeHash 存 sha256 摘要（不存明文）；attempts 限制猜解次数；usedAt 标记已使用防重放
// 重置成功后删除该用户所有会话，强制用新密码重新登录
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),                    // 关联账号邮箱
  codeHash: text("code_hash").notNull(),             // 验证码 sha256 摘要
  attempts: integer("attempts").notNull().default(0),// 已尝试次数（上限 5）
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("password_reset_tokens_email_idx").on(t.email)]);

/* ============ 团队 ============ */
export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// 团队表：高校小组 / 实验室 / 课程团队
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                      // 团队名称
  description: text("description"),                  // 团队简介
  ownerId: integer("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), // 创建者
  createdAt: timestamp("created_at").defaultNow(),
});

// 团队成员表：谁属于哪个团队、担任什么角色
// role: owner（创建者，可解散）/ admin（可管理成员与项目）/ member（普通成员）
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),    // owner / admin / member
  duty: text("duty"),                                // 课程团队分工，与系统权限角色分开保存
  duties: text("duties").array(),                     // 多分工标签；null 时兼容原单标签
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => [unique("team_members_team_user_uq").on(t.teamId, t.userId)]);

/* ============ 项目 ============ */
export const teamInvites = pgTable("team_invites", {
  teamId: integer("team_id").primaryKey().references(() => teams.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
});
export const teamJoinRequests = pgTable("team_join_requests", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique("team_join_requests_team_user_uq").on(t.teamId, t.userId)]);

// 项目表：团队下的协作单元；key 为短代码（如 WEB），与任务 number 组成编号 WEB-024
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                      // 项目名称
  key: text("key").notNull(),                        // 短代码：大写字母开头，2-6 位，团队内唯一
  description: text("description"),                  // 项目描述
  courseName: text("course_name"),                    // 所属课程
  status: text("status").notNull().default("active"),// active / archived
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("projects_team_key_uq").on(t.teamId, t.key)]);

// 项目成员表：项目页头像堆叠 / 任务指派候选名单（建项目时团队全员自动加入）
export const projectMembers = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => [unique("project_members_project_user_uq").on(t.projectId, t.userId)]);

// 项目收藏表：用户可收藏项目（侧栏「已收藏」分组）
export const projectStars = pgTable("project_stars", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("project_stars_project_user_uq").on(t.projectId, t.userId)]);

/* ============ Sprint（迭代） ============ */
export const milestones = pgTable("milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dueOn: date("due_on").notNull(),
  semesterStartsOn: date("semester_starts_on"),
  teachingWeek: integer("teaching_week"),
  teachingWeekday: integer("teaching_weekday"),
  requirements: text("requirements").notNull().default(""),
  completed: boolean("completed").notNull().default(false),
});

export const milestoneTasks = pgTable("milestone_tasks", {
  milestoneId: integer("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
}, (t) => [unique("milestone_tasks_uq").on(t.milestoneId, t.taskId)]);

// 冲刺表：项目的时间盒迭代（如 SPRINT 08），同一项目同时最多一个 active
export const sprints = pgTable("sprints", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                      // 如 SPRINT 08
  goal: text("goal"),                                // 迭代目标
  startsOn: date("starts_on"),                       // 开始日期（YYYY-MM-DD）
  endsOn: date("ends_on"),                           // 交付日期
  status: text("status").notNull().default("planned"), // planned / active / completed
  createdAt: timestamp("created_at").defaultNow(),
});

/* ============ 任务 ============ */

// 任务表：核心实体。编号 = 项目 key + 项目内递增序号（WEB-024）
// status: todo / doing / done；priority: low / medium / high
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sprintId: integer("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
  number: integer("number").notNull(),               // 项目内递增，与 projectId 联合唯一
  title: text("title").notNull(),                    // 标题
  description: text("description"),                  // 描述（纯文本）
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }), // 负责人
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  dueOn: date("due_on"),                             // 截止日期（YYYY-MM-DD）
  parentTaskId: integer("parent_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }), // 子任务自引用
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [unique("tasks_project_number_uq").on(t.projectId, t.number)]);

// 标签表：团队级标签（七个预设色）
export const labels = pgTable("labels", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                      // 标签名
  color: text("color").notNull().default("#3b6ef5"), // 十六进制色值
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("labels_team_name_uq").on(t.teamId, t.name)]);

// 任务-标签关联表（多对多）
export const taskLabels = pgTable("task_labels", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  labelId: integer("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
}, (t) => [unique("task_labels_task_label_uq").on(t.taskId, t.labelId)]);

export const taskCollaborators = pgTable("task_collaborators", {
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [unique("task_collaborators_task_user_uq").on(table.taskId, table.userId)]);

// 任务内轻量步骤，与独立子任务分开保存。
export const taskChecklistItems = pgTable("task_checklist_items", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
}, (table) => [index("task_checklist_task_idx").on(table.taskId)]);

// 评论表：任务下的讨论（支持 @提及）
export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),                // 评论内容
  createdAt: timestamp("created_at").defaultNow(),
});

/* ============ 项目内团队聊天 ============ */

// 聊天消息表：项目频道内的消息流，支持回复、关联任务、置顶、@提及、文件消息与撤回
// attachmentId 非空即文件消息（正文存原始文件名）；文件本体即项目文件（attachments），
// 撤回文件后消息保留但卡片降级为「文件已撤回」；recalled 置位后正文清空、仅显示占位灰字
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),                // 消息内容
  replyToId: integer("reply_to_id").references((): AnyPgColumn => chatMessages.id, { onDelete: "cascade" }), // 回复的目标消息
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),   // 关联任务
  attachmentId: integer("attachment_id").references((): AnyPgColumn => attachments.id, { onDelete: "set null" }), // 文件消息
  pinned: boolean("pinned").notNull().default(false), // 是否置顶（公告，可多条）
  recalled: boolean("recalled").notNull().default(false), // 发送者两分钟内撤回
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 消息表情回应表：同一条消息同一人可对多个表情各回应一次，再点取消（默认 👍 兼容旧数据）
export const chatLikes = pgTable("chat_likes", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull().default("👍"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("chat_likes_message_user_emoji_uq").on(t.messageId, t.userId, t.emoji)]);

/* ============ 日志与通知 ============ */

// 活动记录表：项目日志（谁在何时做了什么），任务创建 / 状态流转 / 指派等都会写入
export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  actorId: integer("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),                  // 机器可读：task.created / task.status_changed / ...
  detail: text("detail").notNull(),                  // 人可读中文句子：如「陈越 将 WEB-024 指派给 林琥」
  createdAt: timestamp("created_at").defaultNow(),
});

// 站内通知表：被指派 / 被@ / 我的任务有新评论
export const taskDeadlineReminders = pgTable("task_deadline_reminders", {
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dueOn: date("due_on").notNull(),
}, (table) => [unique("task_deadline_reminders_task_user_due_uq").on(table.taskId, table.userId, table.dueOn)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),                      // assigned / mention / comment
  title: text("title").notNull(),                    // 通知标题（中文）
  entityType: text("entity_type"),                   // 跳转目标类型：task / project
  entityId: integer("entity_id"),                    // 跳转目标 id
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

/* ============ 附件 ============ */
export const fileCleanup = pgTable("file_cleanup", {
  storedName: text("stored_name").primaryKey(),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

// 附件表：任务 / 项目文件元数据；文件本体存项目根 uploads/ 目录（不入库、不进 Git）
export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  uploaderId: integer("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),     // 原始文件名（下载时展示）
  storedName: text("stored_name").notNull(),         // 存储文件名（随机，防冲突与路径穿越）
  mimeType: text("mime_type"),                       // MIME 类型
  size: integer("size").notNull().default(0),        // 字节数
  createdAt: timestamp("created_at").defaultNow(),
});

/* ============ 私聊 ============ */

// 私聊会话：两个用户一对一；userAId 恒存较小 id（CHECK 约束），保证同一对用户只有一条会话
// hiddenForA/B：某方隐藏会话后从其列表移除；对方发来新消息或重新发起时自动恢复
export const dmConversations = pgTable("dm_conversations", {
  id: serial("id").primaryKey(),
  userAId: integer("user_a_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userBId: integer("user_b_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  hiddenForA: boolean("hidden_for_a").notNull().default(false),
  hiddenForB: boolean("hidden_for_b").notNull().default(false),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),  // 冗余排序字段，发消息时更新
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [unique("dm_conversations_pair_uq").on(t.userAId, t.userBId),
  check("dm_conversations_pair_check", sql`${t.userAId} < ${t.userBId}`)]);

// 私聊消息：readAt 为接收方阅读时间（null 即对方未读），发送方可据此展示「已读」
// attachmentId 非空即文件消息（正文存原始文件名，界面渲染为文件卡片）；
// replyToId 支持引用回复；recalled 为发送者两分钟内撤回
export const dmMessages = pgTable("dm_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => dmConversations.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  replyToId: integer("reply_to_id").references((): AnyPgColumn => dmMessages.id, { onDelete: "cascade" }),
  attachmentId: integer("attachment_id").references((): AnyPgColumn => dmAttachments.id, { onDelete: "set null" }),
  recalled: boolean("recalled").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("dm_messages_conversation_idx").on(t.conversationId)]);

// 私聊附件：文件本体与项目文件一样存项目根 uploads/ 目录（随机存储名，不入库、不进 Git）
export const dmAttachments = pgTable("dm_attachments", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => dmConversations.id, { onDelete: "cascade" }),
  uploaderId: integer("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),          // 原始文件名（下载时展示）
  storedName: text("stored_name").notNull(),              // 存储文件名（随机 UUID，防冲突与路径穿越）
  mimeType: text("mime_type"),
  size: integer("size").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("dm_attachments_conversation_idx").on(t.conversationId)]);

// 私聊个人设置：置顶（排最前）与免打扰（不计入未读角标）；每人每会话一条
export const dmSettings = pgTable("dm_settings", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").notNull().references(() => dmConversations.id, { onDelete: "cascade" }),
  pinned: boolean("pinned").notNull().default(false),
  muted: boolean("muted").notNull().default(false),
}, (t) => [unique("dm_settings_user_conversation_uq").on(t.userId, t.conversationId)]);

/* ============ 云文档 ============ */

// 项目文档：飞书式协作文档，正文本为 Markdown，项目成员均可读可写
export const docs = pgTable("docs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),                          // 标题（80 字以内）
  content: text("content").notNull().default(""),          // Markdown 正文
  folder: text("folder"),                                  // 分组文件夹（空 = 未分组；单层，不做树）
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("docs_project_idx").on(t.projectId)]);

// 文档评论：项目成员对文档的批注；quote 为评论时选中的原文片段（可空）
export const docComments = pgTable("doc_comments", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => docs.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quote: text("quote"),                                    // 引用的文档原文（≤200 字）
  content: text("content").notNull(),                      // 评论内容
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("doc_comments_doc_idx").on(t.docId)]);

// 文档历史版本：每次保存前快照旧内容；每篇文档只保留最近 MAX_DOC_VERSIONS 版
export const docVersions = pgTable("doc_versions", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => docs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),                          // 快照时的标题
  content: text("content").notNull(),                      // 快照时的正文
  editorId: integer("editor_id").references(() => users.id, { onDelete: "set null" }), // 触发本次保存的人
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("doc_versions_doc_idx").on(t.docId)]);

export const milestoneResources = pgTable("milestone_resources", {
  id: serial("id").primaryKey(),
  milestoneId: integer("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
  attachmentId: integer("attachment_id").references(() => attachments.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url"),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("milestone_resources_file_uq").on(table.milestoneId, table.attachmentId),
  unique("milestone_resources_url_uq").on(table.milestoneId, table.url),
  check("milestone_resources_kind_check", sql`(${table.attachmentId} is not null and ${table.url} is null) or (${table.attachmentId} is null and ${table.url} is not null)`)]);

/* ============ 个人效率中心（terry/personal-suite）============ */
// 个人待办：不依赖项目，随手记；按 user_id 隔离。done 标记完成，dueOn 可为空（YYYY-MM-DD）。
export const personalTodos = pgTable("personal_todos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  note: text("note"),                                       // 备注（可空）
  done: boolean("done").notNull().default(false),
  dueOn: date("due_on"),                                    // 截止日 YYYY-MM-DD（可空，用于日历联动）
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("personal_todos_user_idx").on(t.userId)]);

// 个人记事（Keep 风格）：标题 + 正文 + 颜色 + 置顶；按 user_id 隔离。
export const personalNotes = pgTable("personal_notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  color: text("color").notNull().default("yellow"),          // yellow/blue/green/pink/purple
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("personal_notes_user_idx").on(t.userId)]);
