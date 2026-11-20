"use client";

// 全局「新手导引」悬浮入口：登录页/首页/工作台/效率中心等每个页面都能看到，
// 一键进入 /guide 的 8 步导引。与 SuiteLauncher 同层堆叠（在其上方），样式呼应。
// 未登录用户与登录页同样显示——第一次进平台的人恰恰是最需要导引的人。
// 首次访问（localStorage 未记录）时在按钮上方弹出一次性提示气泡，可关闭、不重复打扰。
// 读取 localStorage 用 useSyncExternalStore：服务端与水合期按"已看过"渲染，
// 水合完成后再按真实值刷新，避免 SSR 水合错位（react-hooks lint 也不允许 effect 内同步 setState）。
import { useCallback, useReducer, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

const SEEN_KEY = "agile-guide-visited";
const noopSubscribe = () => () => {};
function readSeen(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

export function GuideLauncher() {
  const router = useRouter();
  const pathname = usePathname();
  // 导引页自身不再放悬浮入口；其余页面全部可见（含登录页与未登录状态）
  const hidden = pathname === "/guide";
  const seen = useSyncExternalStore(noopSubscribe, readSeen, () => true);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const markSeen = useCallback(() => {
    try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* 忽略存储失败 */ }
    bump();
  }, []);

  if (hidden) return null;
  return (
    <div className="guide-launcher-wrap">
      {!seen && (
        <div className="guide-nudge" role="status">
          <div className="guide-nudge-body">
            <b>第一次使用？</b>
            <span>3 分钟新手导引，带你走一遍注册 → 团队 → 看板 → 协作。</span>
          </div>
          <div className="guide-nudge-actions">
            <button
              className="guide-nudge-go"
              onClick={() => { markSeen(); router.push("/guide"); }}
            >
              开始导引
            </button>
            <button
              className="guide-nudge-close"
              aria-label="关闭新手导引提示"
              title="不再提示"
              onClick={markSeen}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <button
        className="su-launcher guide-launcher"
        title="新手导引 · 3 分钟上手"
        aria-label="打开新手导引"
        onClick={() => { markSeen(); router.push("/guide"); }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="M19 16.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
        </svg>
        <span>新手导引</span>
      </button>
    </div>
  );
}
