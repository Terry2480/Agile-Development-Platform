"use client";

// 工作台外壳：不整体缩放，也不设「最小宽度」硬限制。
// - ≥1280（T1）：桌面态原样渲染，多余宽度交给中间列表；
// - 更窄时由 globals.css 的分级响应逐级收敛（T2 密度收紧 → T3 右栏收起 → T4 项目列表抽屉 → T5 顶栏精简），
//   一直自然收缩到任意宽度，挤压交给 flex + 省略号消化，是否够看由用户自己决定窗口宽度。
import type { ReactNode } from "react";

/** 设计基准宽度：≥ 该宽度即桌面态，不做任何布局降级 */
export const WORKSPACE_DESIGN_WIDTH = 1280;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="ws-scale-root">
      <div className="ws-scale-frame">{children}</div>
    </div>
  );
}
