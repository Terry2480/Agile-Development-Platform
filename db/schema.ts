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

// 聊天消息表：项目频道内的消息流，支持回复、关联任务、置顶、@提及
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),                // 消息内容
  replyToId: integer("reply_to_id").references((): AnyPgColumn => chatMessages.id, { onDelete: "cascade" }), // 回复的目标消息
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),   // 关联任务
  pinned: boolean("pinned").notNull().default(false), // 是否置顶（项目公告）
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 消息赞同表：一条消息可被多人赞同（同一用户同一条只能赞一次，再点取消）
export const chatLikes = pgTable("chat_likes", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [unique("chat_likes_message_user_uq").on(t.messageId, t.userId)]);

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
