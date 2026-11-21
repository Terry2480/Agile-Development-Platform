// AI 日报生成器（本地规则引擎）：把工作区一天的数据聚合成人类可读的中文日报。
// 纯函数、不依赖数据库，便于单测；数据聚合见 app/api/home/daily-report/route.ts。
// 「AI」体现在：多源数据汇总 + 逾期/截止优先级排序 + 重点提取（@提及/里程碑）+ 建议生成。

export interface ReportProjectInput {
  id: number;
  name: string;
  taskTotal: number;
  taskDone: number;
  taskDoing: number;
  createdToday: number;
  completedToday: number;
  messagesToday: number;
  docsUpdatedToday: number;
}

export interface DailyReportInput {
  dateKey: string; // YYYY-MM-DD
  dateText: string; // 如：11月19日 星期三
  userName: string;
  projectCount: number;
  myTodo: number;
  myDoing: number;
  myDone: number;
  /** 今天截止且未完成的任务，形如 "AGILE-001 设计登录页视觉稿" */
  deadlineToday: string[];
  /** 已逾期未完成的任务，按 dueOn 升序 */
  overdue: string[];
  /** 明天截止 */
  deadlineTomorrow: string[];
  unreadDms: number;
  unreadNotifications: number;
  projects: ReportProjectInput[];
  milestonesUpcoming: Array<{ projectName: string; title: string; dueOn: string }>;
  /** 今天聊天里提到我的消息，形如 "【项目名】作者：内容" */
  mentionsToday: string[];
}

export interface ReportSection {
  key: "overview" | "projects" | "deadlines" | "mentions" | "milestones";
  title: string;
  lines: string[];
}

export interface DailyReport {
  headline: string;
  summary: string;
  sections: ReportSection[];
  /** 建议优先处理（逾期 → 今天 → 明天，最多 3 条） */
  focusItems: string[];
  generatedAt: string;
}

const pct = (done: number, total: number) => (total === 0 ? 100 : Math.round((done / total) * 100));

/** 日期差（天）：b - a，入参均为 YYYY-MM-DD */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}

/** 截止时间的人类描述：已逾期 N 天 / 今天 / 明天 / N 天后 */
export function dueLabel(dueOn: string, dateKey: string): string {
  const d = daysBetween(dateKey, dueOn);
  if (d < 0) return `已逾期 ${-d} 天`;
  if (d === 0) return "今天截止";
  if (d === 1) return "明天截止";
  return `${d} 天后截止`;
}

export function buildDailyReport(input: DailyReportInput): DailyReport {
  const { dateKey, dateText, userName } = input;
  const todayCreated = input.projects.reduce((s, p) => s + p.createdToday, 0);
  const todayCompleted = input.projects.reduce((s, p) => s + p.completedToday, 0);
  const todayMessages = input.projects.reduce((s, p) => s + p.messagesToday, 0);
  const todayDocs = input.projects.reduce((s, p) => s + p.docsUpdatedToday, 0);
  const myTotal = input.myTodo + input.myDoing + input.myDone;

  const empty = input.projectCount === 0;

  /* ---------- 头条 ---------- */
  let headline: string;
  if (empty) {
    headline = `${dateText}，${userName}，还没有加入任何项目`;
  } else if (input.overdue.length > 0) {
    headline = `${dateText} · 注意：有 ${input.overdue.length} 个任务已逾期`;
  } else if (input.deadlineToday.length > 0) {
    headline = `${dateText} · 今天有 ${input.deadlineToday.length} 个任务截止`;
  } else if (input.myTodo + input.myDoing === 0 && myTotal > 0) {
    headline = `${dateText} · 你的任务全部完成，干得漂亮 👍`;
  } else {
    headline = `${dateText} · ${input.myTodo} 个待办 · ${input.myDoing} 个进行中`;
  }

  /* ---------- 摘要 ---------- */
  const summaryParts: string[] = [];
  summaryParts.push(`共 ${input.projectCount} 个活跃项目`);
  if (myTotal > 0) summaryParts.push(`我的任务完成率 ${pct(input.myDone, myTotal)}%（${input.myDone}/${myTotal}）`);
  if (todayCreated > 0) summaryParts.push(`今日新增 ${todayCreated} 个任务`);
  if (todayCompleted > 0) summaryParts.push(`今日完成 ${todayCompleted} 个`);
  if (todayMessages > 0) summaryParts.push(`${todayMessages} 条协作消息`);
  if (todayDocs > 0) summaryParts.push(`${todayDocs} 篇文档更新`);
  const summary = empty ? "创建团队和项目后，这里会每天自动生成协作日报。" : summaryParts.join("，") + "。";

  /* ---------- 分节 ---------- */
  const sections: ReportSection[] = [];

  sections.push({
    key: "overview",
    title: "今日概览",
    lines: [
      `我的待办 ${input.myTodo} 个 · 进行中 ${input.myDoing} 个 · 已完成 ${input.myDone} 个`,
      input.unreadDms > 0 ? `未读私信 ${input.unreadDms} 条 · 未读通知 ${input.unreadNotifications} 条` : `未读私信 0 条 · 未读通知 ${input.unreadNotifications} 条`,
    ],
  });

  if (input.projects.length > 0) {
    sections.push({
      key: "projects",
      title: "项目动态",
      lines: input.projects.map((p) => {
        const bits = [`${p.name}`, `进度 ${p.taskDone}/${p.taskTotal}（${pct(p.taskDone, p.taskTotal)}%）`];
        if (p.createdToday > 0) bits.push(`新增 ${p.createdToday}`);
        if (p.completedToday > 0) bits.push(`完成 ${p.completedToday}`);
        if (p.messagesToday > 0) bits.push(`消息 ${p.messagesToday} 条`);
        if (p.docsUpdatedToday > 0) bits.push(`文档 ${p.docsUpdatedToday} 篇更新`);
        return bits.join(" · ");
      }),
    });
  }

  const deadlineLines: string[] = [];
  if (input.overdue.length > 0) deadlineLines.push(...input.overdue.map((t) => `⚠️ ${t}（已逾期）`));
  if (input.deadlineToday.length > 0) deadlineLines.push(...input.deadlineToday.map((t) => `${t}（今天截止）`));
  if (input.deadlineTomorrow.length > 0) deadlineLines.push(...input.deadlineTomorrow.map((t) => `${t}（明天截止）`));
  if (deadlineLines.length > 0) {
    sections.push({ key: "deadlines", title: "临近截止", lines: deadlineLines.slice(0, 8) });
  }

  if (input.mentionsToday.length > 0) {
    sections.push({ key: "mentions", title: "提及与我", lines: input.mentionsToday.slice(0, 5) });
  }

  if (input.milestonesUpcoming.length > 0) {
    sections.push({
      key: "milestones",
      title: "里程碑",
      lines: input.milestonesUpcoming.slice(0, 5).map((m) => `${m.projectName}「${m.title}」${dueLabel(m.dueOn, dateKey)}`),
    });
  }

  /* ---------- 建议优先处理 ---------- */
  const focusItems: string[] = [];
  for (const t of input.overdue.slice(0, 3)) focusItems.push(`先补上逾期的 ${t}`);
  const todayLeft = Math.max(0, 3 - focusItems.length);
  for (const t of input.deadlineToday.slice(0, todayLeft)) focusItems.push(`优先完成 ${t}`);
  const tomorrowLeft = Math.max(0, 3 - focusItems.length);
  for (const t of input.deadlineTomorrow.slice(0, tomorrowLeft)) focusItems.push(`准备 ${t}`);
  if (focusItems.length === 0 && empty) focusItems.push("从「项目管理」创建第一个团队和项目开始");
  else if (focusItems.length === 0 && input.myDoing > 0) focusItems.push("推进手头「进行中」的任务，保持节奏");

  return { headline, summary, sections, focusItems: focusItems.slice(0, 3), generatedAt: new Date().toISOString() };
}

/* ---------- AI 周报：把「本周发生了什么」聚合为一页可读总结 ---------- */

export interface WeeklyReportInput {
  weekStart: string; // YYYY-MM-DD（周一）
  weekEnd: string;   // YYYY-MM-DD（周日）
  weekLabelText: string; // 如：11月16日 - 11月22日
  userName: string;
  projectCount: number;
  /** 本周窗口内各项目统计（口径与日报一致，但窗口为一周） */
  projects: Array<{
    name: string;
    created: number;
    completed: number;
    messages: number;
    docsUpdated: number;
    taskTotal: number;
    taskDone: number;
  }>;
  completedThisWeek: number;
  createdThisWeek: number;
  messagesThisWeek: number;
  /** 仍将进入下周的截止（未完成、dueOn >= 下周一），按 dueOn 升序 */
  upcoming: string[];
  /** 本周完成任务的标题清单（最多 5 条） */
  completedTitles: string[];
  unreadDms: number;
}

export interface WeeklyReport {
  headline: string;
  summary: string;
  lines: string[];
  nextWeekFocus: string[];
}

export function buildWeeklyReport(input: WeeklyReportInput): WeeklyReport {
  const { projects } = input;
  const totalDone = projects.reduce((s, p) => s + p.taskDone, 0);
  const totalTasks = projects.reduce((s, p) => s + p.taskTotal, 0);
  const pct = totalTasks === 0 ? 100 : Math.round((totalDone / totalTasks) * 100);
  const busiest = [...projects].sort((a, b) => b.messages - a.messages)[0];

  const headline = projects.length === 0
    ? `${input.weekLabelText} · 本周暂无项目动态`
    : `${input.weekLabelText} · 完成 ${input.completedThisWeek} 项 · 新增 ${input.createdThisWeek} 项 · ${input.messagesThisWeek} 条协作消息`;

  const summaryLines: string[] = [];
  if (projects.length > 0) {
    summaryLines.push(`共 ${projects.length} 个活跃项目，整体完成度 ${pct}%（${totalDone}/${totalTasks}）`);
    if (busiest && busiest.messages > 0) summaryLines.push(`协作最活跃：${busiest.name}（${busiest.messages} 条消息）`);
    if (input.completedThisWeek > 0) summaryLines.push(`本周交付 ${input.completedThisWeek} 项成果`);
  } else {
    summaryLines.push("本周没有项目动态。创建团队和项目后，周报会自动汇总每周进展。");
  }
  const summary = summaryLines.join("；") + "。";

  const lines: string[] = [];
  for (const p of projects) {
    const bits = [`${p.name}`, `进度 ${p.taskDone}/${p.taskTotal}`, `本周新增 ${p.created} · 完成 ${p.completed}`];
    if (p.messages > 0) bits.push(`消息 ${p.messages} 条`);
    if (p.docsUpdated > 0) bits.push(`文档 ${p.docsUpdated} 篇更新`);
    lines.push(bits.join(" · "));
  }
  if (input.completedTitles.length > 0) {
    lines.push("");
    lines.push("本周完成：");
    for (const t of input.completedTitles) lines.push(`  ✓ ${t}`);
  }

  const nextWeekFocus: string[] = [];
  for (const u of input.upcoming.slice(0, 3)) nextWeekFocus.push(`下周关注：${u}`);
  if (nextWeekFocus.length === 0 && input.unreadDms > 0) nextWeekFocus.push(`处理 ${input.unreadDms} 条未读私信`);
  if (nextWeekFocus.length === 0) nextWeekFocus.push("下周从「我的待办」里挑一件事开始");

  return { headline, summary, lines, nextWeekFocus };
}
