"use client";

// 插件宿主：挂在根布局，按启用状态激活/停用内置插件。
// 商城切换状态后通过事件即时生效，无需刷新。
// 权限模型：宿主按插件 manifest 声明的 permissions 过滤能力面——
// 未声明的能力调用即抛错（最小权限原则），为未来第三方插件上架建立真实约束。
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import type { PluginContext, PluginPermission } from "@/lib/plugins/types";
import { builtinPlugins, enabledIds, subscribePlugins } from "./../lib/plugins/registry";

const HOST_VERSION = "7.3.0";
const activePlugins = new Set<string>();

function contextFor(id: string, permissions: PluginPermission[]): PluginContext {
  const allow = (p: PluginPermission) => permissions.includes(p);
  const denied = (p: PluginPermission): never => {
    throw new Error(`插件 ${id} 未声明权限 ${p}，该能力被宿主拒绝`);
  };
  const prefix = `plugin.${id}.`;
  return {
    storage: {
      get: (k) => {
        if (!allow("storage:local")) denied("storage:local");
        try { return localStorage.getItem(prefix + k); } catch { return null; }
      },
      set: (k, v) => {
        if (!allow("storage:local")) denied("storage:local");
        try { localStorage.setItem(prefix + k, v); } catch { /* 忽略 */ }
      },
      remove: (k) => {
        if (!allow("storage:local")) denied("storage:local");
        try { localStorage.removeItem(prefix + k); } catch { /* 忽略 */ }
      },
    },
    // api:read = 以当前用户身份调用平台 GET 接口（只读，无 method/body 参数面）
    api: (function apiGet<T>(path: string) {
      if (!allow("api:read")) denied("api:read");
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
          void plugin.activate?.(contextFor(plugin.id, plugin.permissions));
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
