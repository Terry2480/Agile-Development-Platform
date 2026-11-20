"use client";

// 插件商城：浏览内置插件、查看权限声明、一键启停。
// 标准格式见 docs/PLUGIN-SPEC.md；新插件放入 plugins/<id>/ 并在
// lib/plugins/registry.ts 注册即自动上架。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgileCampusPlugin } from "@/lib/plugins/types";
import { isEnabled, listPlugins, setEnabled, subscribePlugins } from "@/lib/plugins/registry";

import "./plugins.css";

const CATEGORY_LABEL: Record<AgileCampusPlugin["category"], string> = {
  language: "语言", productivity: "效率", theme: "主题", integration: "集成", other: "其他",
};

export default function PluginsPage() {
  const router = useRouter();
  const [plugins, setPlugins] = useState<AgileCampusPlugin[]>([]);
  const [states, setStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = () => {
      const list = listPlugins();
      setPlugins(list);
      setStates(Object.fromEntries(list.map((p) => [p.id, isEnabled(p.id)])));
    };
    load();
    return subscribePlugins(load);
  }, []);

  return (
    <div className="plg-page">
      <header className="plg-head">
        <div className="plg-head__main">
          <h1>插件商城</h1>
          <p>插件为平台增添功能，可随时启用或停用；全部遵循统一的标准格式。</p>
        </div>
        <button type="button" className="plg-back" onClick={() => router.push("/")}>返回首页</button>
      </header>

      <div className="plg-grid">
        {plugins.map((p) => {
          const on = states[p.id] === true;
          return (
            <article key={p.id} className={`plg-card${on ? " plg-card--on" : ""}`}>
              <header className="plg-card__head">
                <span className="plg-card__icon" aria-hidden="true">{p.icon}</span>
                <div>
                  <h2>{p.name}</h2>
                  <span className="plg-card__meta">v{p.version} · {p.author} · {CATEGORY_LABEL[p.category]}</span>
                </div>
                <span className={`plg-badge${on ? " plg-badge--on" : ""}`}>{on ? "已启用" : "未启用"}</span>
              </header>
              <p className="plg-card__desc">{p.description}</p>
              <div className="plg-card__perms">
                <span className="plg-card__perms-label">权限</span>
                {p.permissions.map((perm) => <code key={perm}>{perm}</code>)}
              </div>
              <footer className="plg-card__foot">
                <button
                  type="button"
                  className={`plg-toggle${on ? " plg-toggle--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setEnabled(p.id, !on)}
                >
                  {on ? "停用" : "启用"}
                </button>
              </footer>
            </article>
          );
        })}
        {plugins.length === 0 && <p className="plg-empty">商城暂无插件。按标准格式开发后到 registry 注册即可上架。</p>}
      </div>

      <footer className="plg-foot">
        <p>插件标准格式（含最小示例）见仓库 <code>docs/PLUGIN-SPEC.md</code>；独立副本见 <code>plugin-spec</code> 分支。</p>
      </footer>
    </div>
  );
}
