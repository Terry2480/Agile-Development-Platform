// 演示数据种子：npm run db:seed
// 幂等：若演示团队已存在则跳过。使用库中现有测试账号（无则提示先注册/运行后端）。
// 日期相对今天生成，保证截止日 / Sprint 看起来是"活的"。
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { db } = await import("./index");
  const {
    users, teams, teamMembers, projects, projectMembers, sprints, tasks,
    labels, taskLabels, comments, chatMessages, activities, notifications,
    docs, dmConversations, dmMessages,
  } = await import("./schema");
  const { eq, inArray } = await import("drizzle-orm");

  // ---------- 工具 ----------
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);

  // ---------- 账号 ----------
  const emails = ["test@stu.edu.cn", "chen@stu.edu.cn", "lin@stu.edu.cn", "zhao@stu.edu.cn"];
  const accounts = await db
    .select({ id: users.id, email: users.email, name: users.name, studentId: users.studentId })
    .from(users)
    .where(inArray(users.email, emails));
  if (accounts.length < 4) {
    console.error(`缺少测试账号（需要 ${emails.join("、")}），请先用这些邮箱注册后再运行 seed`);
    process.exit(1);
  }
  const [xu, chen, lin, zhao] = emails.map((e) => accounts.find((a) => a.email === e)!);
  const name = (u: typeof xu) => u.name || u.studentId;

  // ---------- 幂等检查 ----------
  const [existing] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, "敏捷校园研发组")).limit(1);
  if (existing) {
    console.log("演示团队已存在，跳过 seed");
    process.exit(0);
  }

  // ---------- 团队 ----------
  const [team] = await db
    .insert(teams)
    .values({ name: "敏捷校园研发组", description: "软工课程敏捷开发小组：平台研发 + 课程网站两条线", ownerId: xu.id })
    .returning();
  await db.insert(teamMembers).values([
    { teamId: team.id, userId: xu.id, role: "owner" },
    { teamId: team.id, userId: chen.id, role: "admin" },
    { teamId: team.id, userId: lin.id, role: "member" },
    { teamId: team.id, userId: zhao.id, role: "member" },
  ]);

  // ---------- 标签 ----------
  const labelRows = await db
    .insert(labels)
    .values([
      { teamId: team.id, name: "需求", color: "#3b6ef5" },
      { teamId: team.id, name: "前端", color: "#6f9bff" },
      { teamId: team.id, name: "后端", color: "#8ab4ff" },
      { teamId: team.id, name: "测试", color: "#5b8cff" },
      { teamId: team.id, name: "文档", color: "#7aa5ff" },
    ])
    .returning();
  const labelOf = (n: string) => labelRows.find((l) => l.name === n)!.id;

  // ---------- 项目 + 成员 ----------
  const projectRows = await db
    .insert(projects)
    .values([
      {
        teamId: team.id, name: "AgileCampus 平台", key: "AGI",
        description: "高校团队敏捷项目管理平台：任务看板、迭代、聊天与文件协作", createdById: xu.id,
      },
      {
        teamId: team.id, name: "交互设计课程网站", key: "WEB",
        description: "课程作业展示与交互设计资料归档", createdById: chen.id,
      },
    ])
    .returning();
  const [agi, web] = projectRows;
  const memberValues = projectRows.flatMap((p) =>
    [xu, chen, lin, zhao].map((u) => ({ projectId: p.id, userId: u.id })),
  );
  await db.insert(projectMembers).values(memberValues).onConflictDoNothing();

  // ---------- Sprint ----------
  const sprintRows = await db
    .insert(sprints)
    .values([
      { projectId: agi.id, name: "SPRINT 01", goal: "登录系统 + 工作台框架跑通", startsOn: day(-4), endsOn: day(10), status: "active" },
      { projectId: agi.id, name: "SPRINT 02", goal: "任务看板与拖拽、筛选", startsOn: day(11), endsOn: day(25), status: "planned" },
      { projectId: web.id, name: "SPRINT 01", goal: "首页与课程资料页", startsOn: day(-2), endsOn: day(12), status: "active" },
    ])
    .returning();
  const [agiS1, agiS2, webS1] = sprintRows;

  // ---------- 任务 ----------
  type TaskSeed = {
    projectId: number; sprintId: number | null; title: string; description?: string;
    status: string; priority: string; assigneeId: number | null; dueOn: string | null; labelNames?: string[];
  };
  const taskSeeds: TaskSeed[] = [
    { projectId: agi.id, sprintId: agiS1.id, title: "完成需求分析与用户故事梳理", status: "done", priority: "high", assigneeId: xu.id, dueOn: day(-3), labelNames: ["需求", "文档"], description: "对照十几款主流工具抽象最小骨架，产出 P0/P1 功能分层" },
    { projectId: agi.id, sprintId: agiS1.id, title: "搭建 Next.js 项目骨架与 CI", status: "done", priority: "high", assigneeId: chen.id, dueOn: day(-2), labelNames: ["前端"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "部署 PostgreSQL + Drizzle 数据层", status: "done", priority: "high", assigneeId: chen.id, dueOn: day(-1), labelNames: ["后端"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "登录注册与个人设置页", status: "done", priority: "medium", assigneeId: lin.id, dueOn: day(0), labelNames: ["前端"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "任务看板组件（状态分组 + 卡片）", status: "doing", priority: "high", assigneeId: xu.id, dueOn: day(2), labelNames: ["前端"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "团队聊天接口与轮询", status: "doing", priority: "medium", assigneeId: chen.id, dueOn: day(3), labelNames: ["后端"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "编写接口文档与联调说明", status: "doing", priority: "low", assigneeId: zhao.id, dueOn: day(5), labelNames: ["文档"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "Sprint 交付演示排练", status: "todo", priority: "high", assigneeId: xu.id, dueOn: day(9), labelNames: ["文档"] },
    { projectId: agi.id, sprintId: agiS1.id, title: "通知中心红点与已读逻辑", status: "todo", priority: "medium", assigneeId: lin.id, dueOn: day(1), labelNames: ["前端"] },
    { projectId: agi.id, sprintId: agiS2.id, title: "看板拖拽排序（@dnd-kit）", status: "todo", priority: "medium", assigneeId: xu.id, dueOn: day(14), labelNames: ["前端"] },
    { projectId: web.id, sprintId: webS1.id, title: "首页视觉稿定稿", status: "done", priority: "high", assigneeId: zhao.id, dueOn: day(-1), labelNames: ["需求"] },
    { projectId: web.id, sprintId: webS1.id, title: "课程资料归档页", status: "doing", priority: "medium", assigneeId: lin.id, dueOn: day(4), labelNames: ["前端"] },
    { projectId: web.id, sprintId: webS1.id, title: "作业提交入口", status: "todo", priority: "low", assigneeId: zhao.id, dueOn: day(8) },
  ];

  const taskRows: (typeof tasks.$inferSelect)[] = [];
  const counters = new Map<number, number>();
  for (const seed of taskSeeds) {
    const nextNumber = (counters.get(seed.projectId) ?? 0) + 1;
    counters.set(seed.projectId, nextNumber);
    const [row] = await db
      .insert(tasks)
      .values({
        projectId: seed.projectId,
        sprintId: seed.sprintId,
        number: nextNumber,
        title: seed.title,
        description: seed.description ?? null,
        status: seed.status,
        priority: seed.priority,
        assigneeId: seed.assigneeId,
        createdById: xu.id,
        dueOn: seed.dueOn,
      })
      .returning();
    taskRows.push(row);
    if (seed.labelNames?.length) {
      await db
        .insert(taskLabels)
        .values(seed.labelNames.map((n) => ({ taskId: row.id, labelId: labelOf(n) })))
        .onConflictDoNothing();
    }
  }
  const agiTask = (n: number) => taskRows.filter((t) => t.projectId === agi.id)[n - 1];
  const webTask = (n: number) => taskRows.filter((t) => t.projectId === web.id)[n - 1];

  // ---------- 评论 ----------
  await db.insert(comments).values([
    { taskId: agiTask(5).id, authorId: chen.id, content: "状态分组的接口我已经加好了：GET /api/tasks?projectId=&status=", createdAt: hoursAgo(20) },
    { taskId: agiTask(5).id, authorId: xu.id, content: "收到，我这边把「进行中 / 待开始 / 已完成」三组样式对齐设计稿", createdAt: hoursAgo(18) },
    { taskId: agiTask(6).id, authorId: lin.id, content: "@陈测试 轮询间隔先定 8 秒可以吗？", createdAt: hoursAgo(9) },
  ]);

  // ---------- 聊天 ----------
  const chatRows = await db
    .insert(chatMessages)
    .values([
      { projectId: agi.id, authorId: xu.id, content: "SPRINT 01 交付日是两周后，进度落后的任务今天内在群里同步一下风险", createdAt: hoursAgo(30) },
      { projectId: agi.id, authorId: chen.id, content: "数据层这边没问题，drizzle push 已在大家的库上验证过", createdAt: hoursAgo(28) },
      { projectId: agi.id, authorId: lin.id, content: "登录页和设置页联调完成，展示名回落学工号的逻辑也加了", createdAt: hoursAgo(26) },
      { projectId: agi.id, authorId: zhao.id, content: "接口文档我今晚整理出第一版，放在项目文件里", taskId: agiTask(7).id, createdAt: hoursAgo(5) },
      { projectId: agi.id, authorId: xu.id, content: "看板组件进入联调，@陈测试 帮我把筛选参数的返回结构再确认一遍", taskId: agiTask(5).id, createdAt: hoursAgo(3) },
      { projectId: web.id, authorId: zhao.id, content: "首页视觉稿已定稿，资料页参考它的栅格来做", createdAt: hoursAgo(22) },
    ])
    .returning();
  // 置顶公告：AGI 频道第一条
  await db.update(chatMessages).set({ pinned: true }).where(eq(chatMessages.id, chatRows[0].id));

  // ---------- 活动记录 ----------
  const activityValues: (typeof activities.$inferInsert)[] = [];
  taskRows.forEach((t, i) => {
    const key = t.projectId === agi.id ? "AGI" : "WEB";
    const code = `${key}-${String(t.number).padStart(3, "0")}`;
    const creator = t.projectId === web.id && t.number <= 1 ? chen : xu;
    activityValues.push({
      projectId: t.projectId, taskId: t.id, actorId: creator.id,
      action: "task.created", detail: `${name(creator)} 创建了任务 ${code} ${t.title}`,
      createdAt: hoursAgo(60 - i * 2),
    });
    if (t.status !== "todo") {
      activityValues.push({
        projectId: t.projectId, taskId: t.id, actorId: t.assigneeId ?? xu.id,
        action: "task.status_changed", detail: `${name(t.assigneeId ? accounts.find((a) => a.id === t.assigneeId)! : xu)} 将 ${code} 移至「${t.status === "done" ? "已完成" : "进行中"}」`,
        createdAt: hoursAgo(50 - i * 2),
      });
    }
  });
  activityValues.push(
    { projectId: agi.id, actorId: xu.id, action: "project.created", detail: `${name(xu)} 创建了项目 ${agi.name}（AGI）`, createdAt: hoursAgo(72) },
    { projectId: web.id, actorId: chen.id, action: "project.created", detail: `${name(chen)} 创建了项目 ${web.name}（WEB）`, createdAt: hoursAgo(70) },
  );
  await db.insert(activities).values(activityValues);

  // ---------- 通知（演示用）----------
  await db.insert(notifications).values([
    { userId: xu.id, type: "mention", title: `${name(chen)} 在 AgileCampus 平台 频道中提到了你`, entityType: "project", entityId: agi.id, read: false },
    { userId: xu.id, type: "assigned", title: `${name(zhao)} 将任务 WEB-003 指派给你`, entityType: "task", entityId: webTask(3).id, read: false },
    { userId: xu.id, type: "comment", title: `${name(chen)} 评论了任务 AGI-005`, entityType: "task", entityId: agiTask(5).id, read: true },
  ]);

  // ---------- 云文档（演示）----------
  await db.insert(docs).values([
    {
      projectId: agi.id, title: "协作约定与文档写法",
      content: [
        "# 协作约定与文档写法",
        "",
        "本页说明团队文档的推荐写法，**所有成员都可编辑**，改动会自动保存历史版本。",
        "",
        "## 常用语法",
        "",
        "- `# 标题` 分级标题，最多六级",
        "- **粗体**、*斜体*、`行内代码`",
        "- `- 列表项` 无序列表；`1. 列表项` 有序列表",
        "- `> 引用` 强调摘录",
        "",
        "## 约定",
        "",
        "1. 会议纪要按日期倒序放在前文",
        "2. 接口变更同步更新 [接口文档](https://example.com/api-docs)",
        "3. 每篇文档保持单一主题，避免大杂烩",
        "",
        "> 文档即沟通：写清楚背景与结论，比堆砌过程更重要。",
      ].join("\n"),
      createdById: xu.id, updatedById: chen.id,
    },
    {
      projectId: web.id, title: "首页视觉稿评审纪要",
      content: [
        "# 首页视觉稿评审纪要",
        "",
        "**结论**：视觉稿定稿，进入切图与前端实现。",
        "",
        "## 遗留问题",
        "",
        "- [ ] 移动端栅格断点待补",
        "- [ ] 课程资料卡片的信息层级再压一档",
      ].join("\n"),
      createdById: zhao.id, updatedById: zhao.id,
    },
  ]);

  // ---------- 私聊（演示）----------
  const [dm] = await db
    .insert(dmConversations)
    .values({ userAId: Math.min(xu.id, chen.id), userBId: Math.max(xu.id, chen.id) })
    .returning();
  const dmRows = await db
    .insert(dmMessages)
    .values([
      { conversationId: dm.id, senderId: chen.id, content: "看板联调的筛选参数我确认完了，结构没变", createdAt: hoursAgo(4) },
      { conversationId: dm.id, senderId: xu.id, content: "辛苦！我今晚把三列布局对齐，明天上午给你看效果", createdAt: hoursAgo(3) },
      { conversationId: dm.id, senderId: chen.id, content: "好，演示前我们再过一遍验收清单", createdAt: hoursAgo(1) },
    ])
    .returning();
  await db.update(dmConversations).set({ lastMessageAt: dmRows.at(-1)!.createdAt }).where(eq(dmConversations.id, dm.id));
  await db.update(dmMessages).set({ readAt: hoursAgo(0.5) }).where(eq(dmMessages.id, dmRows[0].id));

  console.log("✅ 演示数据已写入：");
  console.log(`   团队：敏捷校园研发组（4 名成员）`);
  console.log(`   项目：AgileCampus 平台 AGI（10 任务）/ 交互设计课程网站 WEB（3 任务）`);
  console.log(`   Sprint：AGI SPRINT 01（进行中）+ SPRINT 02（计划）/ WEB SPRINT 01（进行中）`);
  console.log(`   聊天 6 条（含 1 条置顶公告）、评论 3 条、标签 5 个、通知 3 条`);
  console.log(`   云文档 2 篇、私信会话 1 条（3 条消息）`);
  process.exit(0);
}

main().catch((error) => {
  console.error("seed 失败：", error);
  process.exit(1);
});
