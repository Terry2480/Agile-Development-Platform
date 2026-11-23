import {
  pgTable, serial, text, timestamp, integer, boolean, date, unique, index, check,
  bigint, jsonb, uniqueIndex, foreignKey, primaryKey,
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

/* 文档模块：db/add-documents.ts 同时安装跨行约束和旧清理保护。 */
const docTime = (name: string) => timestamp(name, { withTimezone: true });
const docVersion = (name: string) => bigint(name, { mode: "bigint" }).notNull().default(sql`1`);
const docActor = (name: string) => integer(name).references(() => users.id, { onDelete: "set null" });

export const documentSpaces = pgTable("document_spaces", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "restrict" }),
  templateSet: text("template_set").notNull().default("none"),
  state: text("state").notNull().default("active"), version: docVersion("version"),
  createdAt: docTime("created_at").notNull().defaultNow(),
}, t => [unique("document_spaces_project_uq").on(t.projectId),
  uniqueIndex("document_spaces_public_uq").on(t.teamId).where(sql`${t.projectId} IS NULL`),
  check("document_spaces_state_ck", sql`${t.state} IN ('active','archived','deleting')`),
  check("document_spaces_template_set_ck",sql`${t.templateSet} IN ('none','general','software')`),
  check("document_spaces_version_ck", sql`${t.version} > 0`)]);

export const documentNodes = pgTable("document_nodes", {
  id: serial("id").primaryKey(), spaceId: integer("space_id").notNull().references(() => documentSpaces.id, { onDelete: "restrict" }),
  parentId: integer("parent_id"), kind: text("kind").notNull(), name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(), systemRole: text("system_role"),
  state: text("state").notNull().default("active"), version: docVersion("version"),
  trashBatchId: integer("trash_batch_id").references((): AnyPgColumn => documentTrashBatches.id, { onDelete: "restrict" }),
  deletedAt: docTime("deleted_at"), expiresAt: docTime("expires_at"),
  createdBy: docActor("created_by"), updatedBy: docActor("updated_by"),
  createdAt: docTime("created_at").notNull().defaultNow(), updatedAt: docTime("updated_at").notNull().defaultNow(),
}, t => [unique("document_nodes_id_space_uq").on(t.id, t.spaceId),
  foreignKey({ name: "document_nodes_parent_fk", columns: [t.parentId, t.spaceId], foreignColumns: [t.id, t.spaceId] }).onDelete("restrict"),
  uniqueIndex("document_nodes_root_name_uq").on(t.spaceId, t.normalizedName).where(sql`${t.parentId} IS NULL AND ${t.state} = 'active'`),
  uniqueIndex("document_nodes_child_name_uq").on(t.spaceId, t.parentId, t.normalizedName).where(sql`${t.parentId} IS NOT NULL AND ${t.state} = 'active'`),
  uniqueIndex("document_nodes_recovery_uq").on(t.spaceId).where(sql`${t.systemRole} = 'recovery' AND ${t.state} = 'active'`),
  index("document_nodes_parent_idx").on(t.spaceId, t.parentId), index("document_nodes_expiry_idx").on(t.expiresAt).where(sql`${t.state} = 'trashed'`),
  check("document_nodes_kind_ck", sql`${t.kind} IN ('folder','document','file','link')`),
  check("document_nodes_state_ck", sql`${t.state} IN ('active','trashed','purging')`),
  check("document_nodes_root_ck", sql`${t.parentId} IS NOT NULL OR ${t.kind} = 'folder'`),
  check("document_nodes_name_ck", sql`char_length(${t.name}) BETWEEN 1 AND 200 AND ${t.name} = btrim(${t.name}) AND ${t.name} !~ '[[:cntrl:]/]' AND position(chr(92) in ${t.name}) = 0 AND ${t.name} NOT IN ('.','..')`),
  check("document_nodes_normalized_ck", sql`${t.normalizedName} = translate(${t.name}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`),
  check("document_nodes_recovery_ck", sql`${t.systemRole} IS NULL OR (${t.systemRole} = 'recovery' AND ${t.kind} = 'folder' AND ${t.parentId} IS NULL)`),
  check("document_nodes_trash_ck", sql`(${t.state} = 'active' AND ${t.trashBatchId} IS NULL AND ${t.deletedAt} IS NULL AND ${t.expiresAt} IS NULL) OR (${t.state} IN ('trashed','purging') AND ${t.trashBatchId} IS NOT NULL AND ${t.deletedAt} IS NOT NULL AND ${t.expiresAt} IS NOT NULL AND ${t.expiresAt} > ${t.deletedAt})`),
  check("document_nodes_version_ck", sql`${t.version} > 0`)]);

export const documentBodies = pgTable("document_bodies", {
  nodeId: integer("node_id").primaryKey().references(() => documentNodes.id, { onDelete: "cascade" }),
  formatVersion: integer("format_version").notNull().default(1), contentJson: jsonb("content_json").notNull(),
  bodyRevision: docVersion("body_revision"), contentHash: text("content_hash").notNull(),
  lastCheckpointAt: docTime("last_checkpoint_at"), updatedBy: docActor("updated_by"), updatedAt: docTime("updated_at").notNull().defaultNow(),
}, t => [check("document_bodies_content_ck", sql`jsonb_typeof(${t.contentJson}) = 'object' AND (${t.contentJson}->>'type') IS NOT DISTINCT FROM 'doc' AND octet_length(${t.contentJson}::text) <= 5242880`),
  check("document_bodies_hash_ck", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("document_bodies_revision_ck", sql`${t.bodyRevision} > 0 AND ${t.formatVersion} > 0`)]);

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(), nodeId: integer("node_id").notNull().references(() => documentNodes.id, { onDelete: "cascade" }),
  formatVersion: integer("format_version").notNull().default(1), contentJson: jsonb("content_json").notNull(), contentHash: text("content_hash").notNull(),
  sourceRevision: bigint("source_revision", { mode: "bigint" }).notNull(), bodyAuthorId: docActor("body_author_id"), bodyAuthorName: text("body_author_name").notNull(),
  createdBy: docActor("created_by"), reason: text("reason").notNull(), createdAt: docTime("created_at").notNull().defaultNow(),
}, t => [index("document_versions_node_idx").on(t.nodeId, t.createdAt, t.id),
  check("document_versions_content_ck", sql`jsonb_typeof(${t.contentJson}) = 'object' AND (${t.contentJson}->>'type') IS NOT DISTINCT FROM 'doc' AND octet_length(${t.contentJson}::text) <= 5242880`),
  check("document_versions_hash_ck", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("document_versions_revision_ck", sql`${t.sourceRevision} > 0 AND ${t.formatVersion} > 0`),
  check("document_versions_reason_ck", sql`${t.reason} IN ('edit_start','periodic','manual','before_restore','before_draft_restore')`)]);

export const documentEditLocks = pgTable("document_edit_locks", {
  nodeId: integer("node_id").primaryKey().references(() => documentNodes.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), sessionTokenHash: text("session_token_hash").notNull(),
  acquiredAt: docTime("acquired_at").notNull().defaultNow(), expiresAt: docTime("expires_at").notNull(),
}, t => [index("document_edit_locks_expiry_idx").on(t.expiresAt),
  check("document_edit_locks_token_ck", sql`${t.sessionTokenHash} ~ '^[0-9a-f]{64}$'`),
  check("document_edit_locks_time_ck", sql`${t.expiresAt} > ${t.acquiredAt}`)]);

export const documentResources = pgTable("document_resources", {
  id: serial("id").primaryKey(), teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  storedName: text("stored_name").notNull(), originalName: text("original_name").notNull(), mimeType: text("mime_type"), size: bigint("size", { mode: "bigint" }).notNull(),
  state: text("state").notNull().default("ready"), createdBy: docActor("created_by"), createdAt: docTime("created_at").notNull().defaultNow(),
  stagedForNodeId: integer("staged_for_node_id").references(() => documentNodes.id, { onDelete: "set null" }),
  orphanNotBefore: docTime("orphan_not_before").notNull().default(sql`now() + interval '24 hours'`),
}, t => [unique("document_resources_stored_name_uq").on(t.storedName), index("document_resources_orphan_idx").on(t.orphanNotBefore),
  check("document_resources_state_ck", sql`${t.state} IN ('staged','ready','deleting')`), check("document_resources_size_ck", sql`${t.size} >= 0`),
  check("document_resources_path_ck", sql`char_length(${t.storedName}) BETWEEN 1 AND 255 AND ${t.storedName} NOT IN ('.','..') AND ${t.storedName} !~ '[[:cntrl:]/:]' AND position(chr(92) in ${t.storedName}) = 0`)]);

export const documentFileEntries = pgTable("document_file_entries", {
  nodeId: integer("node_id").primaryKey().references(() => documentNodes.id, { onDelete: "cascade" }),
  resourceId: integer("resource_id").notNull().references(() => documentResources.id, { onDelete: "restrict" }),
});
export const documentLinkEntries = pgTable("document_link_entries", {
  nodeId: integer("node_id").primaryKey().references(() => documentNodes.id, { onDelete: "cascade" }), url: text("url").notNull(),
}, t => [check("document_link_entries_url_ck", sql`${t.url} ~* '^https?://[^[:space:]]+$'`)]);

export const documentExports = pgTable("document_exports", {
  id: serial("id").primaryKey(), teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  spaceId: integer("space_id").notNull().references(() => documentSpaces.id, { onDelete: "restrict" }), requestedBy: docActor("requested_by"),
  state: text("state").notNull().default("queued"), format: text("format").notNull(), snapshotAt: docTime("snapshot_at").notNull().defaultNow(),
  expiresAt: docTime("expires_at").notNull().default(sql`now() + interval '24 hours'`), requestId: text("request_id").notNull(),
  leaseUntil: docTime("lease_until"), attempts: integer("attempts").notNull().default(0), artifactName: text("artifact_name"),
  snapshotMetadata:jsonb("snapshot_metadata").notNull().default(sql`'{}'::jsonb`),
  failureManifest: jsonb("failure_manifest").notNull().default(sql`'[]'::jsonb`),
  createdAt: docTime("created_at").notNull().defaultNow(), updatedAt: docTime("updated_at").notNull().defaultNow(),
}, t => [unique("document_exports_request_uq").on(t.requestedBy, t.requestId), index("document_exports_work_idx").on(t.state, t.leaseUntil),
  check("document_exports_state_ck", sql`${t.state} IN ('queued','running','partial','completed','failed','cancelled','expired')`),
  check("document_exports_format_ck", sql`${t.format} IN ('pdf','markdown')`), check("document_exports_time_ck", sql`${t.expiresAt} > ${t.snapshotAt} AND ${t.attempts} >= 0`)]);

export const documentExportItems = pgTable("document_export_items", {
  id: serial("id").primaryKey(), exportId: integer("export_id").notNull().references(() => documentExports.id, { onDelete: "cascade" }),
  nodeId: integer("node_id").notNull(), relativePath: text("relative_path").notNull(), kind: text("kind").notNull(), snapshotName: text("snapshot_name").notNull(),
  snapshotBody: jsonb("snapshot_body"), snapshotUrl: text("snapshot_url"), resourceId: integer("resource_id").references(() => documentResources.id, { onDelete: "restrict" }),
  state: text("state").notNull().default("pending"), errorCode: text("error_code"), outputSize: bigint("output_size", { mode: "bigint" }).notNull().default(sql`0`),
}, t => [unique("document_export_items_path_uq").on(t.exportId, t.relativePath),
  check("document_export_items_kind_ck", sql`${t.kind} IN ('document','file','link')`),
  check("document_export_items_state_ck", sql`${t.state} IN ('pending','running','completed','failed')`), check("document_export_items_size_ck", sql`${t.outputSize} >= 0`),
  check("document_export_items_content_ck", sql`(${t.kind} = 'document' AND ${t.snapshotBody} IS NOT NULL AND ${t.snapshotUrl} IS NULL AND ${t.resourceId} IS NULL) OR (${t.kind} = 'file' AND ${t.resourceId} IS NOT NULL AND ${t.snapshotBody} IS NULL AND ${t.snapshotUrl} IS NULL) OR (${t.kind} = 'link' AND ${t.snapshotUrl} IS NOT NULL AND ${t.snapshotBody} IS NULL AND ${t.resourceId} IS NULL)`),
  check("document_export_items_path_ck", sql`${t.relativePath} <> '' AND ${t.relativePath} !~ '(^/|(^|/)[.][.](/|$)|[[:cntrl:]:])' AND position(chr(92) in ${t.relativePath}) = 0`)]);

export const documentResourceRefs = pgTable("document_resource_refs", {
  id: serial("id").primaryKey(), resourceId: integer("resource_id").notNull().references(() => documentResources.id, { onDelete: "restrict" }),
  nodeId: integer("node_id").references(() => documentNodes.id, { onDelete: "cascade" }), versionId: integer("version_id").references(() => documentVersions.id, { onDelete: "cascade" }),
  exportItemId: integer("export_item_id").references(() => documentExportItems.id, { onDelete: "cascade" }), role: text("role").notNull(), createdAt: docTime("created_at").notNull().defaultNow(),
}, t => [index("document_resource_refs_resource_idx").on(t.resourceId),
  uniqueIndex("document_resource_refs_node_uq").on(t.nodeId, t.resourceId, t.role).where(sql`${t.nodeId} IS NOT NULL`),
  uniqueIndex("document_resource_refs_version_uq").on(t.versionId, t.resourceId).where(sql`${t.versionId} IS NOT NULL`),
  uniqueIndex("document_resource_refs_export_uq").on(t.exportItemId, t.resourceId).where(sql`${t.exportItemId} IS NOT NULL`),
  check("document_resource_refs_owner_ck", sql`num_nonnulls(${t.nodeId}, ${t.versionId}, ${t.exportItemId}) = 1`),
  check("document_resource_refs_role_ck", sql`(${t.nodeId} IS NOT NULL AND ${t.role} IN ('file','body_image')) OR (${t.versionId} IS NOT NULL AND ${t.role} = 'version_image') OR (${t.exportItemId} IS NOT NULL AND ${t.role} = 'export')`)]);

export const documentImageGrants = pgTable("document_image_grants", {
  nodeId: integer("node_id").notNull().references(() => documentNodes.id, { onDelete: "cascade" }), resourceId: integer("resource_id").notNull().references(() => documentResources.id, { onDelete: "restrict" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), lockTokenHash: text("lock_token_hash").notNull(),
  expiresAt: docTime("expires_at").notNull().default(sql`now() + interval '24 hours'`),
}, t => [primaryKey({ columns: [t.nodeId, t.resourceId, t.userId, t.lockTokenHash] }), index("document_image_grants_resource_idx").on(t.resourceId, t.expiresAt),
  check("document_image_grants_token_ck", sql`${t.lockTokenHash} ~ '^[0-9a-f]{64}$'`)]);

export const documentAssociations = pgTable("document_associations", {
  id: serial("id").primaryKey(), nodeId: integer("node_id").notNull().references(() => documentNodes.id, { onDelete: "restrict" }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }), milestoneId: integer("milestone_id").references(() => milestones.id, { onDelete: "cascade" }),
  createdBy: docActor("created_by"), createdAt: docTime("created_at").notNull().defaultNow(),
}, t => [check("document_associations_target_ck", sql`num_nonnulls(${t.taskId}, ${t.milestoneId}) = 1`),
  uniqueIndex("document_associations_task_uq").on(t.nodeId, t.taskId).where(sql`${t.taskId} IS NOT NULL`),
  uniqueIndex("document_associations_milestone_uq").on(t.nodeId, t.milestoneId).where(sql`${t.milestoneId} IS NOT NULL`)]);

export const documentLegacyFiles = pgTable("document_legacy_files", {
  legacyAttachmentId: integer("legacy_attachment_id").primaryKey(), // 不关联旧行，旧级联删除后仍保留 URL 身份
  nodeId: integer("node_id").notNull().references(() => documentNodes.id, { onDelete: "cascade" }),
  legacyCreatedAt: timestamp("legacy_created_at"), // 原无时区值原样保留，不猜历史时区
}, t => [unique("document_legacy_files_node_uq").on(t.nodeId)]);

export const documentLegacyLinks = pgTable("document_legacy_links", {
  legacyResourceId: integer("legacy_resource_id").primaryKey(),
  nodeId: integer("node_id").notNull().references(() => documentNodes.id, { onDelete: "cascade" }),
}, t => [unique("document_legacy_links_node_uq").on(t.nodeId)]);

export const documentTrashBatches = pgTable("document_trash_batches", {
  id: serial("id").primaryKey(), spaceId: integer("space_id").notNull().references(() => documentSpaces.id, { onDelete: "restrict" }),
  rootNodeId: integer("root_node_id"), deletedBy: docActor("deleted_by"), deletedAt: docTime("deleted_at").notNull().defaultNow(),
  expiresAt: docTime("expires_at").notNull().default(sql`now() + interval '30 days'`),
}, t => [check("document_trash_batches_time_ck", sql`${t.expiresAt} > ${t.deletedAt}`)]);

export const documentTrashItems = pgTable("document_trash_items", {
  nodeId: integer("node_id").primaryKey().references(() => documentNodes.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => documentTrashBatches.id, { onDelete: "restrict" }),
  originalParentId: integer("original_parent_id"), originalPath: jsonb("original_path").notNull(), originalSpaceId: integer("original_space_id").notNull(), originalName: text("original_name").notNull(),
}, t => [index("document_trash_items_batch_idx").on(t.batchId)]);

export const documentRequests = pgTable("document_requests", {
  id: serial("id").primaryKey(), userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(), requestId: text("request_id").notNull(), payloadHash: text("payload_hash").notNull(), state: text("state").notNull().default("pending"),
  resultJson: jsonb("result_json"), createdAt: docTime("created_at").notNull().defaultNow(), expiresAt: docTime("expires_at").notNull().default(sql`now() + interval '24 hours'`),
}, t => [unique("document_requests_key_uq").on(t.userId, t.operation, t.requestId),
  check("document_requests_state_ck", sql`${t.state} IN ('pending','completed','failed')`), check("document_requests_hash_ck", sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);

export const documentCleanupJobs = pgTable("document_cleanup_jobs", {
  resourceId: integer("resource_id").primaryKey().references(() => documentResources.id, { onDelete: "cascade" }),
  notBefore: docTime("not_before").notNull().defaultNow(), attempts: integer("attempts").notNull().default(0), lastError: text("last_error"), leaseUntil: docTime("lease_until"),
}, t => [check("document_cleanup_jobs_attempts_ck", sql`${t.attempts} >= 0`)]);

export const documentMigrationRoots = pgTable("document_migration_roots", {
  spaceId: integer("space_id").notNull().references(() => documentSpaces.id, { onDelete: "cascade" }), role: text("role").notNull(),
  nodeId: integer("node_id").references(() => documentNodes.id, { onDelete: "set null" }),
}, t => [primaryKey({ columns: [t.spaceId, t.role] })]);

export const documentMigrations = pgTable("document_migrations", {
  key: text("key").primaryKey(), checksum: text("checksum").notNull(), details: jsonb("details").notNull().default(sql`'{}'::jsonb`), appliedAt: docTime("applied_at").notNull().defaultNow(),
});

// Metadata-only audit: no old binary history is retained.
export const documentOperations=pgTable("document_operations",{
 id:serial("id").primaryKey(),nodeId:integer("node_id").notNull(),actorId:integer("actor_id"),action:text("action").notNull(),detail:jsonb("detail").notNull(),createdAt:docTime("created_at").notNull().defaultNow(),
},t=>[foreignKey({name:"document_operations_node_id_fkey",columns:[t.nodeId],foreignColumns:[documentNodes.id]}).onDelete("cascade"),foreignKey({name:"document_operations_actor_id_fkey",columns:[t.actorId],foreignColumns:[users.id]}).onDelete("set null"),index("document_operations_node_idx").on(t.nodeId),check("document_operations_action_ck",sql`${t.action} IN ('file.replaced','link.updated')`)]);
