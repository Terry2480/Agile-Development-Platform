"use client";

// 全局「效率中心」悬浮入口：首页/工作台/导引/设置等所有页面可见，一键进入 /suite。
// 登录页与 /suite 自身不显示；未登录用户也不显示（避免无效入口）。
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function SuiteLauncher() {
  const router = useRouter();
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const hidden = pathname === "/login" || pathname === "/suite";

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    fetch("/api/auth/me").then((res) => { if (alive) setAuthed(res.ok); })
      .catch(() => { if (alive) setAuthed(false); });
    return () => { alive = false; };
  }, [hidden]);

  if (hidden || !authed) return null;
  return (
    <button
      className="su-launcher"
      title="效率中心 · 日历 / 待办 / 记事"
      aria-label="打开效率中心"
      onClick={() => router.push("/suite")}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
        <path d="M8 13l2 2 4-4" />
      </svg>
      <span>效率中心</span>
    </button>
  );
}
