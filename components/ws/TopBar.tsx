"use client";

// 顶栏：品牌、项目视图分区菜单（仅项目视图显示）、任务过滤搜索、通知铃铛浮层、头像下拉
// Ctrl+K 已改为打开全局命令面板（CommandPalette）
import { useState } from "react";
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

  const project = ws.projects.find((p) => p.id === ws.selectedId);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="ws-topbar">
      <div className="ws-brand"><i>◇</i>AgileCampus</div>

      {/* 分区菜单降级为「项目视图」内的上下文标签：其他视图不显示，导航层级唯一化 */}
      {ws.railView === "projects" && (
        <nav className="ws-top-menu" aria-label="项目分区">
          <button className={ws.focusSection === "tasks" ? "active" : ""} onClick={() => ws.setFocusSection("tasks")}>项目任务</button>
          <button className={ws.focusSection === "chat" ? "active" : ""} onClick={() => ws.setFocusSection("chat")}>团队聊天</button>
          <button className={ws.focusSection === "space" ? "active" : ""} onClick={() => ws.setFocusSection("space")}>项目概览</button>
        </nav>
      )}

      <div className="ws-top-right">
        {/* 任务过滤搜索仅属于「项目任务」页：其他视图不渲染，避免误导（Ctrl K 全局搜索不受影响） */}
        {ws.railView === "projects" && ws.focusSection === "tasks" && (
          <div className="ws-searchbox" title="过滤当前项目的任务列表；Ctrl K 打开全局搜索">
            <Icon name="search" size={13} />
            <input
              placeholder={project ? `搜索 ${project.name} 的任务…` : "搜索任务…"}
              value={ws.taskSearch}
              onChange={(e) => ws.setTaskSearch(e.target.value)}
            />
            <kbd>Ctrl K</kbd>
          </div>
        )}

        <button className="ws-guide-entry" title="新手导引：8 步快速上手平台" aria-label="打开新手导引" onClick={() => router.push("/guide")}>
          <span className="ws-guide-q">?</span><span>新手导引</span>
        </button>

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
