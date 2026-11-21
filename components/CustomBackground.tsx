"use client";

// 全站自定义背景（个人设置页「外观自定义」写入，全站生效）：
// 预设渐变色板 或 自定义图片 URL，以「氛围层」呈现——固定全屏、pointer-events:none、
// 半透明叠加在页面最底层，不改动任何已有页面布局，清除后完全还原。
// 存储键 agile-custom-bg；跨页签同步走 storage 事件，同页签即时生效走自定义事件。
// 读取用 useSyncExternalStore + 引用稳定的缓存快照（SSR 安全、避免 effect 内同步 setState）。
import { useSyncExternalStore } from "react";

export const CUSTOM_BG_KEY = "agile-custom-bg";
export const CUSTOM_BG_EVENT = "agile-custom-bg-change";

export interface CustomBgSetting {
  mode: "none" | "gradient" | "image";
  value: string;
}

const SERVER_BG: CustomBgSetting = { mode: "none", value: "" }; // 服务端快照（稳定引用）

// 缓存快照：localStorage 原文不变时返回同一对象引用，满足 useSyncExternalStore 的稳定性要求
let cachedRaw: string | null | undefined;
let cachedBg: CustomBgSetting = SERVER_BG;

function subscribe(onChange: () => void) {
  window.addEventListener(CUSTOM_BG_EVENT, onChange);
  window.addEventListener("storage", (e: StorageEvent) => { if (e.key === CUSTOM_BG_KEY) onChange(); });
  return () => {
    window.removeEventListener(CUSTOM_BG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): CustomBgSetting {
  let raw: string | null = null;
  try { raw = localStorage.getItem(CUSTOM_BG_KEY); } catch { raw = null; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CustomBgSetting;
        cachedBg = parsed.mode === "gradient" || parsed.mode === "image" ? parsed : SERVER_BG;
      } catch { cachedBg = SERVER_BG; }
    } else {
      cachedBg = SERVER_BG;
    }
  }
  return cachedBg;
}

/** 写入并广播（设置页调用；同页签立即生效，其他页签经 storage 事件生效） */
export function setCustomBg(setting: CustomBgSetting) {
  try { localStorage.setItem(CUSTOM_BG_KEY, JSON.stringify(setting)); } catch { /* 忽略存储失败 */ }
  cachedRaw = undefined; // 让下一次快照重新解析
  window.dispatchEvent(new Event(CUSTOM_BG_EVENT));
}

/** 预设色板：与站内双主题都能兼容的低饱和氛围渐变 */
export const BG_PRESETS: { name: string; value: string }[] = [
  { name: "星夜蓝紫", value: "linear-gradient(160deg,#0f1220,#1c2440 55%,#3b2f63)" },
  { name: "暖阳米橘", value: "linear-gradient(160deg,#fff6ea,#ffe3c2 55%,#ffd2a8)" },
  { name: "晨雾青绿", value: "linear-gradient(160deg,#eafaf3,#c9f2e2 55%,#a8e8cf)" },
  { name: "深海导航蓝", value: "linear-gradient(160deg,#0a1a2f,#123a5c 55%,#1b5a8a)" },
  { name: "樱粉", value: "linear-gradient(160deg,#fff0f4,#ffd6e4 55%,#ffc2d6)" },
  { name: "石墨黑", value: "linear-gradient(160deg,#0b0b0e,#15161c 55%,#1f2027)" },
];

export function useCustomBg(): CustomBgSetting {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_BG);
}

export function CustomBackground() {
  const bg = useCustomBg();
  if (bg.mode === "none" || !bg.value) return null;
  const isImage = bg.mode === "image";
  return (
    <div
      id="custom-bg-layer"
      aria-hidden
      style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: isImage ? `url("${bg.value.replace(/"/g, "%22")}")` : bg.value,
        backgroundSize: "cover", backgroundPosition: "center",
        opacity: isImage ? 0.22 : 0.55,
      }}
    />
  );
}
