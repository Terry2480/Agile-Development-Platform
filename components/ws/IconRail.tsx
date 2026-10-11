"use client";

// 最左图标栏：品牌、项目/通知/待办导航、底部主题与头像（按设计图）
import { useRouter } from "next/navigation";
import { useWorkspace, Icon, Avatar } from "./shared";
import { displayNameOf } from "./helpers";

export function IconRail() {
  const ws = useWorkspace();
  const router = useRouter();
  const myTodoCount = (ws.overview?.myTodo ?? 0) + (ws.overview?.myDoing ?? 0);

  return (
    <aside className="ws-rail">
      <div className="ws-rail-logo" title="AgileCampus">AC</div>
      <button className={`ws-rail-btn ws-rail-management ${ws.railView === "projectManagement" ? "active" : ""}`} title="项目管理" aria-label="项目管理" onClick={() => ws.setRailView("projectManagement")}><Icon name="file" size={17} /><small>项目管理</small></button>
      <button className={`ws-rail-btn ws-rail-management ${ws.railView === "teamManagement" ? "active" : ""}`} title="团队管理" aria-label="团队管理" onClick={() => ws.setRailView("teamManagement")}><Icon name="users" size={17} /><small>团队管理</small></button>
      <button
        className={`ws-rail-btn ${ws.railView === "projects" ? "active" : ""}`}
        title="项目"
        onClick={() => ws.setRailView("projects")}
      >
        <Icon name="grid" size={17} />
      </button>
      <button
        className={`ws-rail-btn ${ws.railView === "notifications" ? "active" : ""}`}
        title="通知"
        onClick={() => ws.setRailView("notifications")}
      >
        <Icon name="bell" size={17} />
        {ws.unreadCount > 0 && (
          ws.unreadCount > 9
            ? <span className="ws-rail-badge">9+</span>
            : <span className="ws-rail-badge">{ws.unreadCount}</span>
        )}
      </button>
      <button
        className={`ws-rail-btn ${ws.railView === "todos" ? "active" : ""}`}
        title="待办"
        onClick={() => ws.setRailView("todos")}
      >
        <Icon name="check" size={17} />
        {myTodoCount > 0 && <span className="ws-rail-dot blue" />}
      </button>

      <div className="ws-rail-gap" />

      <button className="ws-rail-btn" title="深色模式（当前仅深色）" disabled style={{ opacity: 0.4, cursor: "default" }}>
        <Icon name="sun" size={16} />
      </button>
      <button className="ws-rail-btn" title={`${displayNameOf(ws.me)} · 个人设置`} onClick={() => router.push("/settings")}>
        <Avatar name={displayNameOf(ws.me)} colorKey={ws.me.id} />
      </button>
    </aside>
  );
}
