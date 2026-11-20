"use client";

/**
 * AgileCampus · 新手导引（Onboarding Guide）
 * ------------------------------------------------------------------
 * 面向第一次进入平台的同学，用 8 个步骤讲清「能做什么 / 点哪里 / 怎么上手」。
 * 设计要点：
 *  - 左侧步骤导航可自由跳转，已完成打勾，降低迷路感
 *  - 右侧每步 = 说明 + 要点 + 一张模拟界面图（脉冲高亮「点这里」）
 *  - 底部上一步/下一步 + 顶部进度条，即时反馈当前位置
 *  - 全部内联 SVG 图标（不依赖图标库），独立 CSS 前缀 og-，不污染全局
 * 仅新增文件，不改动任何已有页面与组件。
 */

import { useState } from "react";
import Link from "next/link";
import "./guide.css";

type MockKind = "home" | "login" | "team" | "project" | "board" | "chat" | "today" | "shortcut";

type Step = {
  nav: string;
  kicker: string;
  title: string;
  desc: string;
  bullets: string[];
  tip: string;
  mock: MockKind;
  route: string;
  hl: string;
  label: string;
};

const STEPS: Step[] = [
  {
    nav: "认识平台",
    kicker: "第 1 步 · 全局认知",
    title: "三分钟认识 AgileCampus",
    desc: "这是面向高校课程项目的敏捷协作平台。一个地方放看板、文档、讨论和进度，小组作业不用再在微信、网盘、表格之间来回切。",
    bullets: [
      "首页（/）展示平台能做什么和三步开始入口",
      "工作台（/workspace）是每天真正干活的地方",
      "顶部导航和工作台左侧图标栏是两条主线",
    ],
    tip: "先记住两个地址：/ 是门面，/workspace 是主场。之后所有操作都在工作台里完成。",
    mock: "home",
    route: "/",
    hl: "og-hl-home",
    label: "从这里开始探索",
  },
  {
    nav: "注册登录",
    kicker: "第 2 步 · 进入系统",
    title: "用学工号创建账号",
    desc: "点击首页右上角「登录 / 注册」，填学工号、姓名和密码即可。密码经过加盐哈希存储，登录状态保留 7 天，不用每次重新登。",
    bullets: [
      "学工号是你在团队里的唯一标识，建议用真实学号",
      "已有账号直接登录；忘记密码联系团队管理员重置",
      "登录后自动进入工作台",
    ],
    tip: "学工号别乱填——队友邀请你进团队时，是按学工号匹配成员的。",
    mock: "login",
    route: "/login",
    hl: "og-hl-login",
    label: "点这里注册 / 登录",
  },
  {
    nav: "加入团队",
    kicker: "第 3 步 · 建立组织",
    title: "创建团队或接受邀请",
    desc: "工作台左侧「团队管理」里可以新建团队，或填入队友发来的邀请码加入。团队里分三种角色：所有者、管理员、普通成员。",
    bullets: [
      "所有者（owner）：能改团队设置、删团队",
      "管理员（admin）：能建项目、管成员、发邀请",
      "成员（member）：能建任务、参与讨论和文档",
    ],
    tip: "第一次用建议自己建一个团队练手，把角色权限点一遍就明白了。",
    mock: "team",
    route: "/workspace#teams",
    hl: "og-hl-team",
    label: "点这里管理团队",
  },
  {
    nav: "建项目迭代",
    kicker: "第 4 步 · 搭好骨架",
    title: "建项目，再开一个迭代",
    desc: "团队建好后，在「项目管理」里新建项目，选好课程和迭代周期。项目是任务的容器，迭代则把大目标切成一两周能看到成果的小段。",
    bullets: [
      "一个课程项目对应一个项目，别什么都塞进去",
      "迭代周期建议 1–2 周，和小组周会节奏对齐",
      "建好项目后会自动生成看板、讨论、文件等区域",
    ],
    tip: "迭代不用一开始规划得很满，先拉一个最短周期跑起来，边做边加。",
    mock: "project",
    route: "/workspace#projects",
    hl: "og-hl-project",
    label: "点这里新建项目",
  },
  {
    nav: "任务看板",
    kicker: "第 5 步 · 核心玩法",
    title: "在看板上推进任务",
    desc: "进入项目后的「任务」页是三列看板：待开始 → 进行中 → 已完成。每张卡片能设负责人、截止日、优先级和检查清单，拖动卡片就能改状态。",
    bullets: [
      "点卡片打开详情，拆子任务、勾检查清单、写评论",
      "绿色/黄色/红色标签区分优先级，一眼看清轻重缓急",
      "设了截止日的任务会自动进入「今日」的临期提醒",
    ],
    tip: "把「今天要做」的任务拖到进行中，下班前拖到已完成——进度条和 AI 日报都会跟着变。",
    mock: "board",
    route: "/workspace#tasks",
    hl: "og-hl-board",
    label: "拖动卡片推进状态",
  },
  {
    nav: "协作沟通",
    kicker: "第 6 步 · 团队同步",
    title: "讨论、私聊与云文档",
    desc: "项目里的「讨论」是全员群聊，支持 @提及、表情、引用回复和附件；左侧图标栏还有「私信」和「云文档」，一对一沟通和资料沉淀分开做。",
    bullets: [
      "群聊适合公开同步，私聊适合一对一确认细节",
      "云文档支持多人编辑、评论，还能引用任务",
      "重要结论顺手存进云文档，避免淹没在聊天记录里",
    ],
    tip: "少开一个会，多写一条清楚的讨论——所有沟通都留在项目里，期末复盘有据可查。",
    mock: "chat",
    route: "/workspace",
    hl: "og-hl-chat",
    label: "在这里发消息 @队友",
  },
  {
    nav: "今日视图",
    kicker: "第 7 步 · 每天必看",
    title: "用「今日」开始每一天",
    desc: "工作台「今日」页把散落的信息聚到一起：任务进度条、临期与逾期提醒、AI 生成的中文日报，还有按日期分组的项目日历。",
    bullets: [
      "进度条按「逾期 → 今天 → 明天」排序，先看最紧急的",
      "AI 日报汇总多源数据并给中文建议，不用自己写周报",
      "日历把里程碑和截止日标在月历上，点日期看当天安排",
    ],
    tip: "每天早上先看这一页，10 秒就能知道今天全组在忙什么、有没有要救火的。",
    mock: "today",
    route: "/workspace#today",
    hl: "og-hl-today",
    label: "每天先看这一屏",
  },
  {
    nav: "效率技巧",
    kicker: "第 8 步 · 快人一步",
    title: "两个让你变快的小技巧",
    desc: "按 Ctrl / ⌘ + K 打开命令面板，能直接搜任务、切换项目、跳转页面；右上角太阳/月亮图标可以在日间和夜间主题间切换。",
    bullets: [
      "Ctrl / ⌘ + K：全局搜索与快捷跳转，少点三层菜单",
      "主题切换：晚上做作业切夜间模式，护眼",
      "通知铃铛：看已读/未读消息和截止提醒，别漏事",
    ],
    tip: "把 Ctrl+K 练成肌肉记忆，这是从「会用」到「用得快」的分水岭。",
    mock: "shortcut",
    route: "/workspace",
    hl: "og-hl-shortcut",
    label: "按 Ctrl + K 试试",
  },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "check": return <svg {...p}><path d="M20 6L9 17l-5-5" /></svg>;
    case "left": return <svg {...p}><path d="M15 18l-6-6 6-6" /></svg>;
    case "right": return <svg {...p}><path d="M9 18l6-6-6-6" /></svg>;
    case "home": return <svg {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>;
    case "rocket": return <svg {...p}><path d="M4 14s1-5 5-9c4-4 11-4 11-4s0 7-4 11c-4 4-9 5-9 5l-3-3z" /><circle cx="14.5" cy="9.5" r="1.5" /></svg>;
    case "spark": return <svg {...p}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" /></svg>;
    case "flag": return <svg {...p}><path d="M4 21V4c4-2 8 2 12 0v10c-4 2-8-2-12 0" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

function MockScreen({ step, index }: { step: Step; index: number }) {
  return (
    <div className="og-mock" aria-label={`${step.nav}界面示意`}>
      <div className="og-mock-bar">
        <span className="og-dot" /><span className="og-dot" /><span className="og-dot" />
        <span className="og-mock-url">agilecampus.cn{step.route}</span>
      </div>
      <div className="og-mock-body">
        <div className="og-mock-rail">
          <span className="og-rail-logo">A</span>
          <span className="og-rail-i">▦</span><span className="og-rail-i">◫</span>
          <span className="og-rail-i">◷</span><span className="og-rail-i">☰</span>
        </div>
        <div className="og-mock-main">
          {step.mock === "home" && <>
            <div className="og-mock-hero"><b>敏捷协作 · 课程项目</b><span>三步开始你的第一个敏捷项目</span><i className="og-mock-cta">进入工作台 →</i></div>
            <div className="og-mock-cards"><span/><span/><span/></div>
          </>}
          {step.mock === "login" && <div className="og-mock-form">
            <b>欢迎回来</b>
            <span className="og-mock-field">学工号</span>
            <span className="og-mock-field">密码</span>
            <i className="og-mock-cta og-mock-login">登录 / 注册</i>
          </div>}
          {step.mock === "team" && <>
            <div className="og-mock-heading"><b>团队管理</b><i className="og-mock-cta">+ 新建团队</i></div>
            <div className="og-mock-list">
              <span><em className="og-avatar">软</em> 软件工程小组 <small>owner · 6 人</small></span>
              <span><em className="og-avatar">课</em> 课程设计一组 <small>admin · 4 人</small></span>
            </div>
          </>}
          {step.mock === "project" && <>
            <div className="og-mock-heading"><b>项目管理</b><i className="og-mock-cta">+ 新建项目</i></div>
            <div className="og-mock-list">
              <span>▦ 敏捷工具课程设计 <small>迭代 2 · 进行中</small></span>
              <span>▦ 数据库大作业 <small>迭代 1 · 进行中</small></span>
            </div>
          </>}
          {step.mock === "board" && <div className="og-mock-board">
            <div className="og-mock-col"><small>待开始</small><span className="og-tcard">需求文档 <i className="og-pri red"/></span><span className="og-tcard">用户调研</span></div>
            <div className="og-mock-col"><small>进行中</small><span className="og-tcard">看板开发 <i className="og-pri amber"/></span></div>
            <div className="og-mock-col"><small>已完成</small><span className="og-tcard">项目立项 <i className="og-pri done"/></span></div>
          </div>}
          {step.mock === "chat" && <div className="og-mock-chat">
            <div className="og-bubble left">@陈昱 看板做完记得同步一下</div>
            <div className="og-bubble right">好的，今晚推到进行中</div>
            <div className="og-bubble left">收到，我更新下日报 📌</div>
            <div className="og-mock-input">输入消息… @ 提及队友</div>
          </div>}
          {step.mock === "today" && <div className="og-mock-today">
            <div className="og-mock-heading"><b>今日 · 进度总览</b><small>周四</small></div>
            <div className="og-mock-progress"><span style={{width:"68%"}}/></div>
            <div className="og-mock-two"><div className="og-mini-card"><small>AI 日报</small><span>今日 3 项待办，1 项临期</span></div><div className="og-mini-card"><small>日历</small><span>11 · 里程碑 2 个</span></div></div>
          </div>}
          {step.mock === "shortcut" && <div className="og-mock-shortcut">
            <div className="og-cmd"><span>⌕</span> 搜索任务、项目或跳转页面… <kbd>ESC</kbd></div>
            <div className="og-cmd-list"><span>▦ 跳转到 · 任务看板</span><span>◫ 跳转到 · 云文档</span><span>◷ 跳转到 · 今日视图</span></div>
          </div>}
        </div>
      </div>
      <div className={`og-highlight ${step.hl}`}><span className="og-hl-ring"/><span className="og-hl-tip">{step.label}</span></div>
      <span className="og-mock-stepbadge">示意 · 第 {index + 1}/{STEPS.length} 步</span>
    </div>
  );
}

export default function GuidePage() {
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const step = STEPS[current];
  const progress = Math.round(((done.length) / STEPS.length) * 100);

  const go = (i: number) => { setCurrent(i); setFinished(false); };
  const next = () => {
    if (!done.includes(current)) setDone([...done, current]);
    if (current === STEPS.length - 1) { setFinished(true); return; }
    setCurrent(current + 1);
  };
  const prev = () => { setFinished(false); if (current > 0) setCurrent(current - 1); };
  const restart = () => { setDone([]); setCurrent(0); setFinished(false); };

  return (
    <main className="og-wrap">
      <header className="og-top">
        <div className="og-brand"><span className="og-logo">A</span><span>AgileCampus</span><em>新手导引</em></div>
        <div className="og-progress">
          <div className="og-progress-track"><span style={{ width: `${Math.max(progress, finished ? 100 : (current / STEPS.length) * 100)}%` }} /></div>
          <small>{finished ? "全部完成" : `${Math.max(done.length, current + 1)} / ${STEPS.length} 步`}</small>
        </div>
        <Link className="og-skip" href="/workspace">跳过，直接进工作台 →</Link>
      </header>

      <div className="og-layout">
        <nav className="og-side" aria-label="导引步骤">
          <p className="og-side-title">上手路线</p>
          <ol>
            {STEPS.map((s, i) => (
              <li key={i}>
                <button className={`og-step ${i === current && !finished ? "active" : ""} ${done.includes(i) ? "done" : ""}`} onClick={() => go(i)}>
                  <span className="og-step-num">{done.includes(i) ? <Icon name="check" size={13} /> : i + 1}</span>
                  <span>{s.nav}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="og-side-foot"><Icon name="spark" size={14} /><span>约 3 分钟看完</span></div>
        </nav>

        <section className="og-content">
          {finished ? (
            <div className="og-finish">
              <div className="og-finish-icon"><Icon name="rocket" size={34} /></div>
              <p className="og-kicker">恭喜完成</p>
              <h1>你已经会用它了，开始动手吧</h1>
              <p className="og-finish-desc">从建一个团队、拉一个迭代开始，把第一次课程作业放进来跑一遍，遇到问题回来看对应步骤。</p>
              <div className="og-finish-actions">
                <Link className="og-btn primary" href="/workspace">进入工作台 <Icon name="right" size={16} /></Link>
                <button className="og-btn ghost" onClick={restart}>再看一遍</button>
              </div>
              <div className="og-recap">
                {STEPS.map((s, i) => <span key={i}><Icon name="check" size={13}/>{s.nav}</span>)}
              </div>
            </div>
          ) : (
            <>
              <p className="og-kicker">{step.kicker}</p>
              <h1 className="og-title">{step.title}</h1>
              <p className="og-desc">{step.desc}</p>
              <div className="og-two">
                <div className="og-points">
                  <p className="og-sub">怎么做</p>
                  <ul>{step.bullets.map((b, i) => <li key={i}><span className="og-bullet">{i + 1}</span>{b}</li>)}</ul>
                  <div className="og-tip"><Icon name="flag" size={15} /><div><b>小提示</b><span>{step.tip}</span></div></div>
                </div>
                <div className="og-visual">
                  <p className="og-sub">界面示意</p>
                  <MockScreen step={step} index={current} />
                </div>
              </div>
              <footer className="og-actions">
                <button className="og-btn ghost" onClick={prev} disabled={current === 0}><Icon name="left" size={16} />上一步</button>
                <div className="og-dots">{STEPS.map((_, i) => <span key={i} className={i === current ? "on" : ""} />)}</div>
                <button className="og-btn primary" onClick={next}>{current === STEPS.length - 1 ? "完成导引" : "下一步"}<Icon name="right" size={16} /></button>
              </footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
