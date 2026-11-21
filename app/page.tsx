"use client";

/**
 * AgileCampus · 首页
 * ------------------------------------------------------------------
 * 设计：发布会级深色版面 + 浅蓝 → 紫 → 浅粉 光谱（深空冷黑底 + 极细分割线）
 * 结构：品牌首屏 → 我的数据 / 三步开始 → 进行中的项目 → 能力矩阵
 * 数据：全部复用现有接口（/api/auth/me、/api/overview、/api/projects），
 *       未登录时不请求业务数据，直接按访客态展示，不阻塞首屏。
 * 迁移：原工作台页面需移动到 app/workspace/page.tsx，
 *       本文件替换 app/page.tsx（详见 README）。
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type Me, type Overview, type ProjectSummary } from "@/lib/api-client";
import { useTheme } from "@/components/ws/ThemeProvider";
import { DailyReportCard } from "@/components/ws/DailyReportCard";
import { HomeCalendar } from "@/components/ws/HomeCalendar";

import "./home.css";

/** 工作台路由：原 app/page.tsx 移动后的地址 */
const WORKSPACE_HREF = "/workspace";
const LOGIN_HREF = "/login";

const NAV = [
  { label: "首页", href: "/", active: true },
  { label: "工作台", href: WORKSPACE_HREF, active: false },
  { label: "项目", href: `${WORKSPACE_HREF}#projects`, active: false },
  { label: "团队", href: `${WORKSPACE_HREF}#teams`, active: false },
  { label: "文档", href: `${WORKSPACE_HREF}#docs`, active: false },
] as const;

const CHIPS = ["开箱即用，无需额外配置", "多人实时协作", "面向高校课程项目"] as const;

const STEPS = [
  {
    title: "创建或加入团队",
    desc: "用学校邮箱注册，按学号加入课程团队，或用邀请码组建新团队。",
  },
  {
    title: "建立项目与迭代",
    desc: "选择课程、设定迭代周期，任务创建后直接进入看板。",
  },
  {
    title: "邀请成员开始协作",
    desc: "分工、站会、文档与里程碑在同一处同步，进度肉眼可见。",
  },
] as const;

type Feature = { tag: string; title: string; desc: string; icon: ReactNode; href: string };

const FEATURES: Feature[] = [
  {
    tag: "BOARD",
    title: "任务看板",
    desc: "待开始 / 进行中 / 已完成三列流转，截止日、优先级与检查清单同步更新。",
    icon: <IconBoard />,
    href: `${WORKSPACE_HREF}#tasks`,
  },
  {
    tag: "STANDUP",
    title: "每日站会",
    desc: "在项目频道完成站会，进展与阻塞自动汇总成当日摘要，不必再逐条追问。",
    icon: <IconChat />,
    href: `${WORKSPACE_HREF}#chat`,
  },
  {
    tag: "MILESTONE",
    title: "里程碑",
    desc: "把答辩节点、交付物与参考资料挂到同一条时间线上，关键日期不再漏项。",
    icon: <IconFlag />,
    href: `${WORKSPACE_HREF}#space`,
  },
  {
    tag: "DOCS",
    title: "文档协作",
    desc: "课程文档在线协作，版本留痕、评论可追溯，随时回到任意一稿。",
    icon: <IconDoc />,
    href: `${WORKSPACE_HREF}#docs`,
  },
];

type HomeState = {
  loading: boolean;
  user: Me | null;
  overview: Overview | null;
  projects: ProjectSummary[];
};

const INITIAL: HomeState = { loading: true, user: null, overview: null, projects: [] };

/* ------------------------------------------------------------------ 工具 */

function greetingWord(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function displayNameOf(user: Me): string {
  const name = user.name?.trim();
  if (name) return name;
  const mail = user.email.split("@")[0];
  return mail || "同学";
}

/** 兼容 "2026-11-30" 与完整 ISO 两种写法 */
function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function percentOf(project: ProjectSummary): number {
  const total = project.taskCounts?.total ?? 0;
  if (!total) return 0;
  return Math.round(((project.taskCounts?.done ?? 0) / total) * 100);
}

/* ------------------------------------------------------------------ 页面 */

export default function HomePage() {
  const [state, setState] = useState<HomeState>(INITIAL);
  const [hour, setHour] = useState<number | null>(null);
  const { theme, toggle } = useTheme();

  // 问候语由客户端计算，服务端首帧固定渲染“你好”，避免水合不一致；
  // rAF 延迟到首帧绘制后，避免 effect 内同步 setState 触发级联渲染
  useEffect(() => {
    const id = requestAnimationFrame(() => setHour(new Date().getHours()));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      let user: Me | null = null;
      try {
        const data = await api<{ user: Me }>("/api/auth/me");
        user = data.user;
      } catch {
        user = null; // 未登录：按访客态展示，不视为错误
      }
      if (!alive) return;
      setState((prev) => ({ ...prev, user, loading: false }));
      if (!user) return;

      const [overviewRes, projectsRes] = await Promise.all([
        api<{ overview: Overview }>("/api/overview").catch(() => null),
        api<{ projects: ProjectSummary[] }>("/api/projects").catch(() => null),
      ]);
      if (!alive) return;
      setState((prev) => ({
        ...prev,
        overview: overviewRes?.overview ?? prev.overview,
        projects: projectsRes?.projects ?? prev.projects,
      }));
    };

    void run();
    return () => {
      alive = false;
    };
  }, []);

  const { user, overview, projects, loading } = state;
  const name = user ? displayNameOf(user) : "";
  const greetWord = hour === null ? "你好" : greetingWord(hour);

  const activeProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (a, b) =>
            Number(b.starred) - Number(a.starred) ||
            (b.taskCounts?.total ?? 0) - (a.taskCounts?.total ?? 0),
        )
        .slice(0, 4),
    [projects],
  );

  const doneRate =
    overview && overview.taskTotal > 0
      ? Math.round((overview.taskDone / overview.taskTotal) * 100)
      : 0;

  const myOpen = (overview?.myTodo ?? 0) + (overview?.myDoing ?? 0);

  return (
    <div className="ac-home">
      {/* ------------------------------------------------------------ 导航 */}
      <header className="ac-nav">
        <div className="ac-nav__inner">
          <Link className="ac-brand" href="/" aria-label="AgileCampus 首页">
            <span className="ac-brand__mark" aria-hidden="true">
              <IconLogo />
            </span>
            <span className="ac-brand__text">
              <strong>AgileCampus</strong>
              <i aria-hidden="true" />
              <span>敏捷校园</span>
            </span>
          </Link>

          <nav className="ac-nav__links" aria-label="主导航">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`ac-nav__link${item.active ? " ac-nav__link--active" : ""}`}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ac-nav__actions">
            <button
              type="button"
              className="ac-theme-btn"
              onClick={toggle}
              aria-label={theme === "night" ? "切换日间模式" : "切换夜间模式"}
              title={theme === "night" ? "切换日间模式" : "切换夜间模式"}
            >
              {theme === "night" ? <IconSun /> : <IconMoon />}
            </button>
            {user ? (
              <Link className="ac-user ac-user--link" href="/settings" title="个人设置" aria-label={`进入个人设置（${name}）`}>
                <span className="ac-user__avatar" aria-hidden="true">
                  {initialsOf(name)}
                </span>
                <span>{name}</span>
              </Link>
            ) : (
              <Link className="ac-btn ac-btn--ghost" href={LOGIN_HREF}>
                登录
              </Link>
            )}
            <Link className="ac-btn ac-btn--primary" href={WORKSPACE_HREF}>
              进入工作台
              <IconArrow />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- 首屏 */}
        <section className="ac-hero">
          <div className="ac-hero__copy">
            <span className="ac-eyebrow">
              <i aria-hidden="true" />
              Agile · 校园敏捷协作平台
            </span>

            <h1 className="ac-title">
              把课程项目
              <br />
              做得<em>清晰而漂亮</em>
            </h1>

            <p className="ac-lead">
              分工、看板、站会、文档与里程碑，收进同一个工作台。
              <br className="ac-lead__br" />
              从开学第一周到结课答辩，团队的节奏始终清晰。
            </p>

            <div className="ac-cta">
              <Link
                className="ac-btn ac-btn--primary ac-btn--lg"
                href={user ? WORKSPACE_HREF : LOGIN_HREF}
              >
                {user ? "进入工作台" : "登录并开始"}
                <IconArrow />
              </Link>
              <a className="ac-btn ac-btn--ghost ac-btn--lg" href="#features">
                看看它能做什么
              </a>
            </div>

            <ul className="ac-chips">
              {CHIPS.map((text) => (
                <li className="ac-chip" key={text}>
                  <IconCheck />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* 视觉：一个数据焦点，其余留白 */}
          <div className="ac-art" aria-hidden="true">
            <div className="ac-art__stage">
              <div className="ac-art__glow" />
              <div className="ac-art__guide" />
              <div className="ac-art__guide ac-art__guide--inner" />
              <div className="ac-art__ring" />
              <div className="ac-art__orbit" />

              <div className="ac-art__core">
                <span className="ac-art__num">
                  68<span>%</span>
                </span>
                <span className="ac-art__cap">本迭代完成度</span>
              </div>

              <div className="ac-art__tag ac-art__tag--top">
                <i />
                Sprint 14 · 进行中
              </div>
              <div className="ac-art__tag ac-art__tag--bottom">
                剩余 9 天 <span aria-hidden="true">·</span> 4 位成员
              </div>
            </div>

            <ul className="ac-art__legend">
              <li>
                <em />
                <b>12</b> 已完成
              </li>
              <li>
                <em />
                <b>4</b> 进行中
              </li>
              <li>
                <em />
                <b>2</b> 待开始
              </li>
            </ul>
          </div>
        </section>

        {/* -------------------------------------------- 已登录：我的概览 */}
        {user ? (
          <section className="ac-section" aria-labelledby="ac-overview">
            <h2 className="ac-greet" id="ac-overview">
              {greetWord}，{name}
              <span>
                {myOpen > 0
                  ? `今天有 ${myOpen} 项任务需要推进`
                  : "今天没有待办，可以去看看里程碑"}
              </span>
            </h2>

            <div className="ac-stats">
              <Link className="ac-stat ac-stat--link" href={`${WORKSPACE_HREF}#teams`} title="查看团队管理">
                <span className="ac-stat__label">我的团队</span>
                <span className="ac-stat__value">
                  {loading ? "—" : (overview?.teamCount ?? 0)}
                </span>
                <span className="ac-stat__meta">已加入的团队</span>
              </Link>
              <Link className="ac-stat ac-stat--link" href={`${WORKSPACE_HREF}#projects`} title="查看项目管理">
                <span className="ac-stat__label">进行中项目</span>
                <span className="ac-stat__value">
                  {loading ? "—" : (overview?.projectCount ?? 0)}
                </span>
                <span className="ac-stat__meta">状态为 active</span>
              </Link>
              <Link className="ac-stat ac-stat--link" href={`${WORKSPACE_HREF}#tasks`} title="查看任务看板">
                <span className="ac-stat__label">任务完成</span>
                <span className="ac-stat__value">
                  {loading ? "—" : (overview?.taskDone ?? 0)}
                  <small>/ {loading ? "—" : (overview?.taskTotal ?? 0)}</small>
                </span>
                <span className="ac-stat__meta">完成率 {loading ? "—" : `${doneRate}%`}</span>
              </Link>
              <Link className="ac-stat ac-stat--link" href={`${WORKSPACE_HREF}#todos`} title="查看我的待办">
                <span className="ac-stat__label">我的待办</span>
                <span className="ac-stat__value">{loading ? "—" : (overview?.myTodo ?? 0)}</span>
                <span className="ac-stat__meta">进行中 {loading ? "—" : (overview?.myDoing ?? 0)} 项</span>
              </Link>
            </div>

            {!loading && overview && overview.taskTotal > 0 && (
              <Link className="ac-progress ac-progress--link" href={`${WORKSPACE_HREF}#tasks`} aria-label="去任务看板查看进度">
                <span className="ac-progress__num">
                  任务进度 {overview.taskDone}/{overview.taskTotal}（{doneRate}%）
                </span>
                <div className="ac-progress__track" aria-hidden="true">
                  <div
                    className={`ac-progress__fill${doneRate >= 100 ? " full" : ""}`}
                    style={{ width: `${doneRate}%` }}
                  />
                </div>
                <span className="ac-progress__meta">
                  待办 {overview.myTodo} · 进行中 {overview.myDoing} · 已完成 {overview.taskDone}
                </span>
              </Link>
            )}
          </section>
        ) : (
          /* ------------------------------------------ 访客：三步开始 */
          <section className="ac-section">
            <div className="ac-start">
              <div className="ac-start__body">
                <span className="ac-kicker">Get started</span>
                <h2 className="ac-h2">三步，开始你的第一个敏捷项目</h2>
                <p className="ac-section__desc">
                  用学校邮箱注册，加入课程团队，剩下的交给工作台。第一次使用大约需要两分钟。
                </p>
                <Link className="ac-btn ac-btn--primary ac-btn--lg" href={LOGIN_HREF}>
                  登录 / 注册
                  <IconArrow />
                </Link>
              </div>

              <ol className="ac-steps">
                {STEPS.map((step, index) => (
                  <li className="ac-step" key={step.title}>
                    <span className="ac-step__n">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <b>{step.title}</b>
                      <p>{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* -------------------------------------- 已登录：AI 日报与日历 */}
        {user && (
          <section className="ac-section" aria-labelledby="ac-daily">
            <div className="ac-section__head">
              <div>
                <span className="ac-kicker">Today</span>
                <h2 className="ac-h2" id="ac-daily">
                  AI 日报与日历
                </h2>
              </div>
              <Link className="ac-link" href={`${WORKSPACE_HREF}#tasks`}>
                去工作台处理
                <IconArrow />
              </Link>
            </div>

            <div className="ac-dash">
              <DailyReportCard />
              <HomeCalendar />
            </div>
          </section>
        )}

        {/* ------------------------------------------ 已登录：进行中的项目 */}
        {user && (
          <section className="ac-section" aria-labelledby="ac-projects">
            <div className="ac-section__head">
              <div>
                <span className="ac-kicker">Workspace</span>
                <h2 className="ac-h2" id="ac-projects">
                  进行中的项目
                </h2>
              </div>
              <Link className="ac-link" href={`${WORKSPACE_HREF}#projects`}>
                查看全部
                <IconArrow />
              </Link>
            </div>

            {activeProjects.length > 0 ? (
              <div className="ac-projects">
                {activeProjects.map((project) => {
                  const percent = percentOf(project);
                  const remaining = daysLeft(project.activeSprint?.endsOn);
                  const meta = [project.courseName, project.teamName]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Link className="ac-project ac-project--link" key={project.id} href={`${WORKSPACE_HREF}?project=${project.id}`} title={`进入 ${project.name} 工作台`}>
                      <span className="ac-project__badge" aria-hidden="true">
                        {(project.key || "AC").slice(0, 4).toUpperCase()}
                      </span>

                      <div>
                        <div className="ac-project__title">
                          {project.name}
                          <em>
                            {project.starred ? "已收藏" : "项目"} ·{" "}
                            {project.activeSprint?.name ?? "暂无迭代"}
                          </em>
                        </div>
                        <div className="ac-project__meta">
                          {meta || "未填写课程与团队"}
                          {remaining !== null && (
                            <>
                              {" · "}
                              {remaining >= 0 ? `迭代剩余 ${remaining} 天` : `迭代已超期 ${-remaining} 天`}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="ac-project__progress">
                        <span className="ac-bar" aria-hidden="true">
                          <i style={{ width: `${percent}%` }} />
                        </span>
                        <span>{percent}%</span>
                      </div>

                      <div className="ac-avatars ac-project__people">
                        {project.members.slice(0, 4).map((member) => (
                          <span
                            className="ac-avatar"
                            key={member.userId}
                            title={member.name}
                            aria-label={member.name}
                          >
                            {initialsOf(member.name)}
                          </span>
                        ))}
                        {project.members.length > 4 && (
                          <span className="ac-avatar ac-avatar--more">
                            +{project.members.length - 4}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="ac-empty">
                <p>还没有进行中的项目。先在团队里创建一个，任务就会出现在工作台。</p>
                <Link className="ac-btn ac-btn--ghost" href={WORKSPACE_HREF}>
                  去工作台创建
                  <IconArrow />
                </Link>
              </div>
            )}
          </section>
        )}

        {/* -------------------------------------------------------- 能力矩阵 */}
        <section className="ac-section" id="features" aria-labelledby="ac-features">
          <div className="ac-section__head ac-section__head--center">
            <span className="ac-kicker">Capabilities</span>
            <h2 className="ac-h2" id="ac-features">
              一个工作台，覆盖课程项目全流程
            </h2>
            <p className="ac-section__desc">
              分工、进度、沟通与文档不再散落在五个工具里。每个环节都有明确的位置，
              团队只需要关心一件事：把事情做完。
            </p>
          </div>

          <div className="ac-features">
            {FEATURES.map((feature) => (
              <Link className="ac-feature ac-feature--link" key={feature.tag} href={feature.href} title={`进入${feature.title}`}>
                <span className="ac-feature__tag">{feature.tag}</span>
                <span className="ac-feature__icon">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {/* -------------------------------------------------------------- 页脚 */}
      <footer className="ac-footer">
        <div className="ac-footer__inner">
          <Link className="ac-brand" href="/">
            <span className="ac-brand__mark" aria-hidden="true">
              <IconLogo />
            </span>
            <span className="ac-brand__text">
              <strong>AgileCampus</strong>
              <i aria-hidden="true" />
              <span>敏捷校园</span>
            </span>
          </Link>
          <p className="ac-footer__note">面向高校学生团队的敏捷协作平台 · 课程项目管理工具</p>
          <span className="ac-footer__ver">v7.3</span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ 图标 */

function IconLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.6 18.4 12 5.6l6.4 12.8M8.8 13.6h6.4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10h11M11 5.5 15.5 10 11 14.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSun() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M15.4 12.4A6.4 6.4 0 0 1 7.6 4.6a6.4 6.4 0 1 0 7.8 7.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
      <path
        d="m5.4 8.2 1.8 1.8 3.4-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBoard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="5" height="15" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="4.5" width="5" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="15.5" y="4.5" width="5" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.5 12.4c0 3.9-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4.2 20.4l1.3-3.3A6.6 6.6 0 0 1 3.5 12.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.6 12h6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFlag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 20.5V4.2M6 5h9.4l-1.6 3.3 1.6 3.3H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13.8 3.5H7.2c-.9 0-1.6.7-1.6 1.6v13.8c0 .9.7 1.6 1.6 1.6h9.6c.9 0 1.6-.7 1.6-1.6V8.2l-4.6-4.7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.6 4v4.2h4.4M9 12.6h6M9 16h4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
