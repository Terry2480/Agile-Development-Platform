import Link from "next/link";
import styles from "./page.module.css";

type ProjectType = "course" | "innovation" | "competition" | "research";
type ProjectFilter = "all" | ProjectType;

const FILTERS: Array<{ id: ProjectFilter; label: string }> = [
  { id: "all", label: "全部项目" },
  { id: "course", label: "课程" },
  { id: "innovation", label: "大创" },
  { id: "competition", label: "竞赛" },
  { id: "research", label: "科研" },
];

const TYPE_LABEL: Record<ProjectType, string> = {
  course: "课程项目",
  innovation: "大创项目",
  competition: "竞赛项目",
  research: "科研项目",
};

const PROJECTS: Array<{
  id: string;
  name: string;
  type: ProjectType;
  team: string;
  summary: string;
  progress: number;
  doneTasks: number;
  totalTasks: number;
  milestone: string;
  milestoneDate: string;
  updated: string;
  members: string[];
}> = [
  {
    id: "campus-collaboration",
    name: "校园项目协作平台",
    type: "innovation",
    team: "无所谓队",
    summary: "让课程、大创与科研项目的过程资料持续沉淀。",
    progress: 68,
    doneTasks: 11,
    totalTasks: 16,
    milestone: "中期检查材料",
    milestoneDate: "10.18",
    updated: "今天更新",
    members: ["林", "陈", "周"],
  },
  {
    id: "interaction-design",
    name: "校园服务体验优化",
    type: "course",
    team: "交互设计小组",
    summary: "从用户访谈到高保真原型，完整记录设计过程。",
    progress: 42,
    doneTasks: 5,
    totalTasks: 12,
    milestone: "原型评审",
    milestoneDate: "09.28",
    updated: "昨天更新",
    members: ["林", "许", "吴"],
  },
  {
    id: "blue-bridge",
    name: "蓝桥杯算法训练",
    type: "competition",
    team: "个人项目",
    summary: "整理训练计划、错题记录和赛前复盘。",
    progress: 82,
    doneTasks: 18,
    totalTasks: 22,
    milestone: "省赛报名",
    milestoneDate: "10.03",
    updated: "周一更新",
    members: ["林"],
  },
  {
    id: "lab-reading",
    name: "实验室文献阅读助手",
    type: "research",
    team: "智能交互实验室",
    summary: "归档论文笔记、实验记录与每周组会结论。",
    progress: 31,
    doneTasks: 4,
    totalTasks: 13,
    milestone: "阶段实验记录",
    milestoneDate: "10.12",
    updated: "周一更新",
    members: ["林", "陈", "郭"],
  },
];

const TASKS = [
  {
    title: "补齐项目首页交互稿",
    project: "校园项目协作平台",
    due: "今天 · 18:00",
    tone: "urgent",
  },
  {
    title: "提交访谈纪要",
    project: "校园服务体验优化",
    due: "明天 · 12:00",
    tone: "soon",
  },
  {
    title: "复盘动态规划错题",
    project: "蓝桥杯算法训练",
    due: "周五 · 20:00",
    tone: "normal",
  },
];

const RECENT_FILES = [
  { name: "第三次组会纪要", project: "校园项目协作平台", time: "今天 10:40", kind: "会议纪要" },
  { name: "用户访谈记录", project: "校园服务体验优化", time: "昨天 18:20", kind: "研究记录" },
  { name: "第 4 周周报", project: "实验室文献阅读助手", time: "周一 16:05", kind: "周报" },
];

function valueFromQuery(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function buildFilterHref(filter: ProjectFilter, query: string) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("type", filter);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/home-preview?${search}` : "/home-preview";
}

export default async function HomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = valueFromQuery(params.q).trim().slice(0, 60);
  const requestedType = valueFromQuery(params.type);
  const filter = FILTERS.some((item) => item.id === requestedType)
    ? (requestedType as ProjectFilter)
    : "all";
  const normalizedQuery = query.toLocaleLowerCase("zh-CN");

  const visibleProjects = PROJECTS.filter((project) => {
    const matchesType = filter === "all" || project.type === filter;
    const searchable = `${project.name} ${project.team} ${project.summary} ${TYPE_LABEL[project.type]}`;
    return matchesType && searchable.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });

  const activeProjects = PROJECTS.length;
  const pendingTasks = PROJECTS.reduce(
    (total, project) => total + project.totalTasks - project.doneTasks,
    0,
  );
  const doneTasks = PROJECTS.reduce((total, project) => total + project.doneTasks, 0);
  const totalTasks = PROJECTS.reduce((total, project) => total + project.totalTasks, 0);
  const completion = Math.round((doneTasks / totalTasks) * 100);
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/home-preview" className={styles.brand} aria-label="AgileCampus 首页方案">
            <span className={styles.brandMark} aria-hidden="true">A</span>
            <span className={styles.brandName}>AgileCampus</span>
          </Link>

          <nav className={styles.primaryNav} aria-label="主导航">
            <Link href="/home-preview" aria-current="page" className={styles.navActive}>工作台</Link>
            <Link href="/teams" className={styles.navLink}>团队</Link>
            <Link href="/demo" className={styles.navLink}>项目演示</Link>
          </nav>

          <div className={styles.account}>
            <span className={styles.previewBadge}>首页方案</span>
            <span className={styles.avatar} aria-label="样例用户 林同学">林</span>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.welcome}>
          <div>
            <p className={styles.eyebrow}>个人工作台 <span aria-hidden="true">/</span> {todayLabel}</p>
            <h1>让每个项目，都有清晰的下一步。</h1>
            <p className={styles.welcomeText}>课程、大创、竞赛与科研进度，在一个地方接着推进。</p>
          </div>
          <Link href="/teams" className={styles.primaryButton}>新建项目</Link>
        </section>

        <section className={styles.summary} aria-label="项目概览">
          <SummaryItem label="进行中的项目" value={activeProjects} suffix="个项目" tone="green" />
          <SummaryItem label="待完成任务" value={pendingTasks} suffix="项任务" tone="orange" />
          <SummaryItem label="本周截止" value={3} suffix="项任务" tone="coral" />
          <SummaryItem label="整体任务完成" value={completion} suffix="%" tone="teal" />
        </section>

        <div className={styles.dashboard}>
          <section className={styles.projectSection} aria-labelledby="projects-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>保持节奏，稳步向前</p>
                <h2 id="projects-title">正在推进</h2>
              </div>
              <span className={styles.resultCount}>
                {visibleProjects.length} <span>个项目</span>
              </span>
            </div>

            <div className={styles.projectControls}>
              <nav className={styles.filters} aria-label="按项目类型筛选">
                {FILTERS.map((item) => (
                  <Link
                    key={item.id}
                    href={buildFilterHref(item.id, query)}
                    aria-current={filter === item.id ? "page" : undefined}
                    className={filter === item.id ? styles.filterActive : styles.filterLink}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <form action="/home-preview" method="get" className={styles.searchForm} role="search">
                {filter !== "all" && <input type="hidden" name="type" value={filter} />}
                <label className={styles.srOnly} htmlFor="project-search">搜索项目</label>
                <input
                  id="project-search"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="搜索项目或团队"
                />
                <button type="submit">搜索</button>
              </form>
            </div>

            {visibleProjects.length > 0 ? (
              <ul className={styles.projectGrid}>
                {visibleProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectCard project={project} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.emptyState}>
                <span className={styles.emptyMark} aria-hidden="true">?</span>
                <h3>没有找到匹配的项目</h3>
                <p>试试其他关键词，或切换项目类型。</p>
                <Link href="/home-preview" className={styles.textLink}>清除筛选</Link>
              </div>
            )}
          </section>

          <aside className={styles.sidebar} aria-label="近期工作">
            <section className={styles.sideSection} aria-labelledby="tasks-title">
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>从重要的事开始</p>
                  <h2 id="tasks-title">本周待办</h2>
                </div>
                <span className={styles.sideCount}>3</span>
              </div>
              <ul className={styles.taskList}>
                {TASKS.map((task) => (
                  <li key={task.title} className={styles.taskItem}>
                    <span className={`${styles.taskDot} ${styles[`taskDot-${task.tone}`]}`} aria-hidden="true" />
                    <div className={styles.taskCopy}>
                      <p className={styles.taskTitle}>{task.title}</p>
                      <p className={styles.taskProject}>{task.project}</p>
                      <p className={`${styles.taskDue} ${task.tone === "urgent" ? styles.taskDueUrgent : ""}`}>
                        {task.due}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.sideSection} aria-labelledby="milestones-title">
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>提前一点准备</p>
                  <h2 id="milestones-title">即将到来的节点</h2>
                </div>
              </div>
              <ol className={styles.milestoneList}>
                {PROJECTS.slice(1, 4).map((project) => (
                  <li key={project.id} className={styles.milestoneItem}>
                    <time className={styles.milestoneDate}>{project.milestoneDate}</time>
                    <div>
                      <p className={styles.milestoneTitle}>{project.milestone}</p>
                      <p className={styles.milestoneProject}>{project.name}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className={styles.sideSection} aria-labelledby="files-title">
              <div className={styles.sideHeading}>
                <div>
                  <p className={styles.eyebrow}>过程资料持续沉淀</p>
                  <h2 id="files-title">最近更新</h2>
                </div>
                <Link href="/demo" className={styles.textLink}>查看资料</Link>
              </div>
              <ul className={styles.fileList}>
                {RECENT_FILES.map((file) => (
                  <li key={file.name} className={styles.fileItem}>
                    <span className={styles.fileMark} aria-hidden="true">{file.kind.slice(0, 1)}</span>
                    <div className={styles.fileCopy}>
                      <p className={styles.fileName}>{file.name}</p>
                      <p className={styles.fileMeta}>{file.project} <span>·</span> {file.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        <footer className={styles.footer}>
          <span>AgileCampus 学生项目工作台</span>
          <span>项目进度一目了然，重要资料随时找得到。</span>
        </footer>
      </div>
    </main>
  );
}

function SummaryItem({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix: string;
  tone: string;
}) {
  return (
    <div className={styles.summaryItem}>
      <span className={`${styles.summaryDot} ${styles[`summaryDot-${tone}`]}`} aria-hidden="true" />
      <div>
        <p className={styles.summaryLabel}>{label}</p>
        <p className={styles.summaryValue}>
          {value}<span>{suffix}</span>
        </p>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
}: {
  project: (typeof PROJECTS)[number];
}) {
  return (
    <article className={`${styles.projectCard} ${styles[`card-${project.type}`]}`}>
      <div className={styles.projectCardTop}>
        <span className={`${styles.typeMark} ${styles[`typeMark-${project.type}`]}`} aria-hidden="true">
          {TYPE_LABEL[project.type].slice(0, 1)}
        </span>
        <div className={styles.projectTags}>
          <span className={`${styles.typeLabel} ${styles[`typeLabel-${project.type}`]}`}>
            {TYPE_LABEL[project.type]}
          </span>
          <span className={styles.activeLabel}><span aria-hidden="true" />进行中</span>
        </div>
        <span className={styles.updatedLabel}>{project.updated}</span>
      </div>

      <h3 className={styles.projectTitle}>
        <Link href="/demo" aria-label={`打开${project.name}演示`}>{project.name}</Link>
      </h3>
      <p className={styles.projectTeam}>{project.team}</p>
      <p className={styles.projectSummary}>{project.summary}</p>

      <div className={styles.progressBlock}>
        <div className={styles.progressHeading}>
          <span>任务进度</span>
          <strong>{project.progress}%</strong>
        </div>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={`${project.name}任务完成度`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={project.progress}
        >
          <span style={{ width: `${project.progress}%` }} />
        </div>
        <div className={styles.progressMeta}>
          <span>{project.doneTasks} / {project.totalTasks} 项任务完成</span>
          <span className={styles.memberStack} aria-label={`${project.members.length} 位成员`}>
            {project.members.map((member, index) => (
              <span key={`${member}-${index}`} className={styles.memberAvatar}>{member}</span>
            ))}
          </span>
        </div>
      </div>

      <div className={styles.milestoneBar}>
        <span className={styles.milestoneLabel}>下一节点</span>
        <span className={styles.milestoneName}>{project.milestone}</span>
        <time className={styles.milestoneDue}>{project.milestoneDate}</time>
      </div>
    </article>
  );
}
