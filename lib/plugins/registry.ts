// 插件注册表：内置插件在此上架；启用状态持久化在 localStorage。
"use client";

import type { AgileCampusPlugin } from "./types";
import { i18nMultilangPlugin } from "@/plugins/i18n-multilang/plugin";

const ENABLED_KEY = "agilecampus-plugins-enabled";
const CHANGE_EVENT = "agilecampus-plugins-change";

export const builtinPlugins: AgileCampusPlugin[] = [i18nMultilangPlugin];

export function listPlugins(): AgileCampusPlugin[] {
  return builtinPlugins;
}

export function getPlugin(id: string): AgileCampusPlugin | undefined {
  return builtinPlugins.find((p) => p.id === id);
}

function readEnabled(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function isEnabled(id: string): boolean {
  return readEnabled()[id] === true;
}

export function enabledIds(): string[] {
  const state = readEnabled();
  return Object.keys(state).filter((k) => state[k]);
}

export function setEnabled(id: string, on: boolean) {
  const state = readEnabled();
  state[id] = on;
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify(state)); } catch { /* 存储被禁时仅本次会话生效 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribePlugins(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
