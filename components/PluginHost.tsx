"use client";

// 插件宿主：挂在根布局，按启用状态激活/停用内置插件。
// 商城切换状态后通过事件即时生效，无需刷新。
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import type { PluginContext } from "@/lib/plugins/types";
import { builtinPlugins, enabledIds, subscribePlugins } from "./../lib/plugins/registry";

const HOST_VERSION = "7.3.0";
const activePlugins = new Set<string>();

function contextFor(id: string): PluginContext {
  const prefix = `plugin.${id}.`;
  return {
    storage: {
      get: (k) => { try { return localStorage.getItem(prefix + k); } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(prefix + k, v); } catch { /* 忽略 */ } },
      remove: (k) => { try { localStorage.removeItem(prefix + k); } catch { /* 忽略 */ } },
    },
    api: (function apiGet<T>(path: string) {
      return api<T>(path);
    }) as PluginContext["api"],
    hostVersion: HOST_VERSION,
  };
}

export function PluginHost() {
  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (!alive) return;
      const enabled = new Set(enabledIds());
      for (const plugin of builtinPlugins) {
        const shouldRun = enabled.has(plugin.id);
        const running = activePlugins.has(plugin.id);
        if (shouldRun && !running) {
          activePlugins.add(plugin.id);
          void plugin.activate?.(contextFor(plugin.id));
        } else if (!shouldRun && running) {
          activePlugins.delete(plugin.id);
          plugin.deactivate?.();
        }
      }
    };
    sync();
    const unsub = subscribePlugins(sync);
    return () => {
      alive = false;
      unsub();
      for (const plugin of builtinPlugins) {
        if (activePlugins.has(plugin.id)) {
          activePlugins.delete(plugin.id);
          plugin.deactivate?.();
        }
      }
    };
  }, []);
  return null;
}
