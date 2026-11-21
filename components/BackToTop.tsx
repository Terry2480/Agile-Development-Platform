"use client";

// 全站「回到顶部」小圆钮：长页面（营销首页 / 导引 / 效率中心）向下滚动超过一屏半时出现，
// 平滑滚回顶部。悬浮在效率中心与新手导引按钮上方，不遮挡内容；遵循 reduced-motion。
import { useEffect, useState } from "react";

export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.scrollingElement ?? document.documentElement;
      setShow(doc.scrollTop > innerHeight * 1.5);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;
  return (
    <button
      className="back-to-top"
      title="回到顶部"
      aria-label="回到顶部"
      onClick={() => {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
