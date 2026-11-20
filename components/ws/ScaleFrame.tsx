"use client";

// 等比缩放容器：工作台按 1280px 设计宽度整屏渲染；窗口更窄时整体 transform 缩小，
// 任何窗口宽度/浏览器缩放下都保持完整桌面布局，不触发窄屏重排（不隐藏面板、不折行顶栏）。
// 原理：scale = min(1, 视口宽 / 设计宽)；缩放后 frame 的 CSS 高度按 1/scale 放大，
// 视觉上恰好铺满整个视口高度。transform 会成为内部 fixed 元素（抽屉/弹窗）的包含块，
// 因此它们自动铺满缩放后的全屏，比例一致。
import { useEffect, useState, type ReactNode } from "react";

export const WORKSPACE_DESIGN_WIDTH = 1280;

export function ScaleFrame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      setScale(Math.min(1, window.innerWidth / WORKSPACE_DESIGN_WIDTH));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="ws-scale-root">
      <div
        className="ws-scale-frame"
        style={{
          width: WORKSPACE_DESIGN_WIDTH,
          height: `${100 / scale}vh`,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
