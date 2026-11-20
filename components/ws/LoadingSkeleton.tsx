"use client";

// 骨架屏：加载态占位（shimmer 动画，reduced-motion 时静止）。按列表形态给出常见变体。
export function SkeletonBlock({ h, w, radius = 8, style }: { h: number; w?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="ws-skel" style={{ height: h, width: w ?? "100%", borderRadius: radius, ...style }} aria-hidden="true" />;
}

// 任务卡：编号短线 + 标题长线 + 元数据短线
export function TaskListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ws-skel-list" role="status" aria-label="正在加载任务">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ws-skel-card">
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
            <SkeletonBlock h={11} w={70} />
            <SkeletonBlock h={15} w={`${72 - (i % 3) * 9}%`} />
          </div>
          <SkeletonBlock h={22} w={54} radius={999} />
        </div>
      ))}
    </div>
  );
}

// 会话列表：头像圆 + 两行文字
export function ConversationSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ws-skel-list" role="status" aria-label="正在加载私信" style={{ padding: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ws-skel-row">
          <SkeletonBlock h={26} w={26} radius={8} />
          <div style={{ flex: 1, display: "grid", gap: 7 }}>
            <SkeletonBlock h={12} w={`${60 - (i % 2) * 12}%`} />
            <SkeletonBlock h={10} w={`${80 - (i % 3) * 10}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// 文档行：图标 + 标题/摘要两行
export function DocListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ws-skel-list" role="status" aria-label="正在加载文档">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ws-skel-card">
          <SkeletonBlock h={28} w={28} radius={8} />
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
            <SkeletonBlock h={14} w={`${46 - (i % 3) * 7}%`} />
            <SkeletonBlock h={11} w={`${88 - i * 6}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}
