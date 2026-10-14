"use client";

// 顶栏：品牌、分区菜单、Ctrl+K 搜索、通知铃铛浮层、头像下拉（设置/退出）
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useWorkspace, Icon, Avatar } from "./shared";
import { displayNameOf } from "./helpers";
import { ClearReadNotifications } from "./ClearReadNotifications";
import { NotificationEntry } from "./NotificationEntry";

export function TopBar() {
  const ws = useWorkspace();
  const router = useRouter();
  const [showNotif, setShowNotif] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + K 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const project = ws.projects.find((p) => p.id === ws.selectedId);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="ws-topbar">
      <div className="ws-brand"><i>◇</i>AgileCampus</div>

      <nav className="ws-top-menu">
        <button className={ws.railView === "projects" && ws.focusSection === "tasks" ? "active" : ""} onClick={() => { ws.setRailView("projects"); ws.setFocusSection("tasks"); }}>项目任务</button>
        <button className={ws.railView === "projects" && ws.focusSection === "chat" ? "active" : ""} onClick={() => { ws.setRailView("projects"); ws.setFocusSection("chat"); }}>团队聊天</button>
        <button className={ws.railView === "projects" && ws.focusSection === "space" ? "active" : ""} onClick={() => { ws.setRailView("projects"); ws.setFocusSection("space"); }}>项目概览</button>
      </nav>

      <div className="ws-top-right">
        <div className="ws-searchbox">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            placeholder={ws.railView === "todos" ? "搜索我的待办…" : project ? `搜索 ${project.name} 的任务…` : "搜索任务…"}
            value={ws.taskSearch}
            onChange={(e) => ws.setTaskSearch(e.target.value)}
          />
          <kbd>Ctrl K</kbd>
        </div>

        <div className="ws-bell-wrap">
          <button className="ws-rail-btn" style={{ width: 34, height: 34 }} title="通知" onClick={() => setShowNotif((v) => !v)}>
            <Icon name="bell" size={16} />
            {ws.unreadCount > 0 && <span className="ws-rail-dot" />}
          </button>
          {showNotif && (
            <div className="ws-pop" onMouseDown={(e) => e.stopPropagation()}>
              <div className="ws-pop-head">
                <b>通知</b>
                <ClearReadNotifications />
                {ws.unreadCount > 0 && (
                  <button onClick={() => ws.markRead()}>全部已读</button>
                )}
              </div>
              <div className="ws-pop-list">
                {ws.notifications.length === 0 && (
                  <div style={{ padding: "28px 14px", textAlign: "center", fontSize: 12, color: "var(--ws-color-5d6273)" }}>暂无通知</div>
                )}
                {ws.notifications.map((n) => (
                  <NotificationEntry key={n.id} notification={n} onOpened={() => setShowNotif(false)} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="ws-user-wrap">
          <button className="ws-rail-btn" style={{ width: 34, height: 34 }} title={displayNameOf(ws.me)} onClick={() => setShowUser((v) => !v)}>
            <Avatar name={displayNameOf(ws.me)} colorKey={ws.me.id} />
          </button>
          {showUser && (
            <div className="ws-user-menu">
              <div style={{ padding: "8px 11px 6px", fontSize: 11, color: "var(--ws-color-5d6273)", borderBottom: "1px solid #22242f", marginBottom: 4 }}>
                {displayNameOf(ws.me)}<br />{ws.me.email}
              </div>
              <button onClick={() => router.push("/settings")}>
                <Icon name="settings" size={14} /> 个人设置
              </button>
              <button onClick={logout}>
                <Icon name="logout" size={14} /> 退出用户
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
