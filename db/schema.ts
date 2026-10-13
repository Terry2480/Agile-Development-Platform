import {
  pgTable, serial, text, timestamp, integer, boolean, date, unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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
