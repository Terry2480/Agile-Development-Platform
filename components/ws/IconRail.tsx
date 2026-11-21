"use client";

// 最左图标栏：品牌、项目/通知/待办导航、底部主题与头像（按设计图）
import { useRouter } from "next/navigation";
import { useWorkspace, Icon, Avatar } from "./shared";
import { displayNameOf } from "./helpers";
import { useTheme } from "./ThemeProvider";

export function IconRail() {
  const ws = useWorkspace();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const myTodoCount = (ws.overview?.myTodo ?? 0) + (ws.overview?.myDoing ?? 0);

  return (
    <aside className="ws-rail">
      <div className="ws-rail-logo" title="AgileCampus">AC</div>
      <button
        className="ws-rail-btn"
        title="首页"
        aria-label="返回首页"
        onClick={() => router.push("/")}
      >
        <Icon name="home" size={17} />
      </button>
      {/* 今日视图（AI 日报 / 日历 / 任务进度）在 v6.4 后没有图标栏入口，成为隐藏功能——补回 */}
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "today" ? "active" : ""}`}
        title="今日 · 进度 / AI 日报 / 日历"
        aria-label="今日"
        onClick={() => ws.setRailView("today")}
      >
        <Icon name="calendar" size={17} />
        <small>今日</small>
      </button>
      <button className={`ws-rail-btn ws-rail-management ${ws.railView === "projectManagement" ? "active" : ""}`} title="项目管理" aria-label="项目管理" onClick={() => ws.setRailView("projectManagement")}><Icon name="file" size={17} /><small>项目管理</small></button>
      <button className={`ws-rail-btn ws-rail-management ${ws.railView === "teamManagement" ? "active" : ""}`} title="团队管理" aria-label="团队管理" onClick={() => ws.setRailView("teamManagement")}><Icon name="users" size={17} /><small>团队管理</small></button>
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "projects" ? "active" : ""}`}
        title="工作台"
        aria-label="工作台"
        onClick={() => ws.setRailView("projects")}
      >
        <Icon name="grid" size={17} />
        <small>工作台</small>
      </button>
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "notifications" ? "active" : ""}`}
        title="通知"
        onClick={() => ws.setRailView("notifications")}
      >
        <Icon name="bell" size={17} />
        <small>通知</small>
        {ws.unreadCount > 0 && (
          ws.unreadCount > 9
            ? <span className="ws-rail-badge">9+</span>
            : <span className="ws-rail-badge">{ws.unreadCount}</span>
        )}
      </button>
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "todos" ? "active" : ""}`}
        title="待办"
        onClick={() => ws.setRailView("todos")}
      >
        <Icon name="check" size={17} />
        <small>待办</small>
        {myTodoCount > 0 && <span className="ws-rail-dot blue" />}
      </button>
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "messages" ? "active" : ""}`}
        title="私信"
        aria-label="私信"
        onClick={() => ws.setRailView("messages")}
      >
        <Icon name="message" size={17} />
        <small>私聊</small>
        {ws.dmUnreadTotal > 0 && (
          ws.dmUnreadTotal > 9
            ? <span className="ws-rail-badge">9+</span>
            : <span className="ws-rail-badge">{ws.dmUnreadTotal}</span>
        )}
      </button>
      <button
        className={`ws-rail-btn ws-rail-management ${ws.railView === "docs" ? "active" : ""}`}
        title="云文档"
        aria-label="云文档"
        onClick={() => ws.setRailView("docs")}
      >
        <Icon name="book" size={17} />
        <small>云文档</small>
      </button>

      <div className="ws-rail-gap" />

      <button className="ws-rail-btn ws-rail-management" title="新手导引" aria-label="新手导引" onClick={() => router.push("/guide")}>
        <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>?</span>
        <small>导引</small>
      </button>
      <button className="ws-rail-btn ws-rail-management" title="插件商城" aria-label="插件商城" onClick={() => router.push("/plugins")}>
        <Icon name="puzzle" size={17} />
        <small>插件</small>
      </button>
      <button className="ws-rail-btn" title={theme === "night" ? "切换日间模式" : "切换夜间模式"} aria-label={theme === "night" ? "切换日间模式" : "切换夜间模式"} onClick={toggle}>
        <Icon name={theme === "night" ? "sun" : "moon"} size={18} />
      </button>
      <button className="ws-rail-btn" title={`${displayNameOf(ws.me)} · 个人设置`} onClick={() => router.push("/settings")}>
        <Avatar name={displayNameOf(ws.me)} colorKey={ws.me.id} />
      </button>
    </aside>
  );
}
