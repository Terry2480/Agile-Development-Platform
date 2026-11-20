// 插件：多语言（i18n-multilang）
// ------------------------------------------------------------------
// 按 AgileCampus 插件标准格式实现（docs/PLUGIN-SPEC.md）。
// 能力：启用后页面右下角出现地球切换器，可把界面文案切换为
//       英语 / 日语 / 法语 / 俄语（未收录长句保持原文）。
// 原理：DOM 文本节点与常用属性（placeholder/title/aria-label）按词典
//       精确替换；MutationObserver 跟踪 SPA 局部刷新；停用时完整还原。
"use client";

import type { AgileCampusPlugin, PluginContext } from "@/lib/plugins/types";
import { DICTIONARIES, LOCALES, type Locale } from "./dictionary";

const STORAGE_KEY = "locale";

let observer: MutationObserver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let uiRoot: HTMLElement | null = null;
let ctxRef: PluginContext | null = null;
let currentLocale: Locale | null = null;

/** 原文登记表：Text 节点与属性 → 翻译前内容，用于还原与换语言 */
const textOriginals = new Map<Text, string>();
const attrOriginals = new Map<Attr, string>();
const ATTRS = ["placeholder", "title", "aria-label"];

function pruneOrphan() {
  for (const node of textOriginals.keys()) if (!node.isConnected) textOriginals.delete(node);
  for (const attr of attrOriginals.keys()) if (!attr.ownerElement?.isConnected) attrOriginals.delete(attr);
}

function dict(): Record<string, string> | null {
  return currentLocale ? DICTIONARIES[currentLocale] : null;
}

/** 翻译一个根子树（文本节点 + 白名单属性） */
function translateRoot(root: ParentNode) {
  const d = dict();
  if (!d) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    const raw = node.nodeValue ?? "";
    const key = raw.trim();
    if (!key || key.length > 40) continue;
    const hit = d[key];
    if (!hit) continue;
    if (!textOriginals.has(node)) textOriginals.set(node, raw);
    node.nodeValue = raw.replace(key, hit);
  }
  for (const el of Array.from(root.querySelectorAll("[" + ATTRS.join("],[" ) + "]"))) {
    for (const name of ATTRS) {
      const attr = el.getAttributeNode(name);
      if (!attr) continue;
      const raw = attr.value ?? "";
      const key = raw.trim();
      const hit = key && key.length <= 40 ? d[key] : undefined;
      if (!hit) continue;
      if (!attrOriginals.has(attr)) attrOriginals.set(attr, raw);
      attr.value = raw.replace(key, hit);
    }
  }
}

/** 还原所有已翻译内容（停用或切换语言前调用） */
function restoreAll() {
  for (const [node, raw] of textOriginals) if (node.isConnected) node.nodeValue = raw;
  for (const [attr, raw] of attrOriginals) if (attr.ownerElement?.isConnected) attr.value = raw;
  textOriginals.clear();
  attrOriginals.clear();
}

function applyLocale(locale: Locale | null) {
  restoreAll();
  currentLocale = locale;
  if (locale) {
    translateRoot(document.body);
    pruneOrphan();
  }
}

/* ---------------- 语言切换器（原生 DOM，插件自带 UI） ---------------- */

function buildSwitcher() {
  if (uiRoot?.isConnected) return;
  const wrap = document.createElement("div");
  wrap.className = "i18n-switcher";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "i18n-switcher__btn";
  btn.title = "语言 / Language";
  btn.setAttribute("aria-label", "切换界面语言");
  btn.textContent = "🌐";
  const menu = document.createElement("div");
  menu.className = "i18n-switcher__menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  for (const item of LOCALES) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "i18n-switcher__opt";
    opt.setAttribute("role", "menuitem");
    opt.dataset.locale = item.code;
    opt.textContent = item.native;
    if (item.code === "zh") opt.textContent += "（默认）";
    opt.addEventListener("click", () => {
      const next = item.code === "zh" ? null : (item.code as Locale);
      ctxRef?.storage.set(STORAGE_KEY, item.code);
      applyLocale(next);
      menu.hidden = true;
      syncActive();
    });
    menu.appendChild(opt);
  }
  function syncActive() {
    const cur = ctxRef?.storage.get(STORAGE_KEY) ?? "zh";
    menu.querySelectorAll(".i18n-switcher__opt").forEach((el) => {
      el.classList.toggle("active", (el as HTMLElement).dataset.locale === cur);
    });
  }
  btn.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) syncActive();
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) menu.hidden = true;
  });
  wrap.append(btn, menu);
  document.body.appendChild(wrap);
  uiRoot = wrap;
  syncActive();
}

function removeSwitcher() {
  uiRoot?.remove();
  uiRoot = null;
}

/* ------------------------- 生命周期 ------------------------- */

export const i18nMultilangPlugin: AgileCampusPlugin = {
  id: "i18n-multilang",
  name: "多语言",
  version: "1.0.0",
  author: "AgileCampus 团队",
  description: "把界面文案切换为英语 / 日语 / 法语 / 俄语；未收录的长句保持原文，随时可切回中文。",
  category: "language",
  icon: "🌐",
  permissions: ["ui:translate", "ui:mount", "storage:local"],
  activate(ctx) {
    ctxRef = ctx;
    const saved = ctx.storage.get(STORAGE_KEY);
    currentLocale = saved && saved !== "zh" && saved in DICTIONARIES ? (saved as Locale) : null;
    buildSwitcher();
    applyLocale(currentLocale);
    observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (currentLocale) translateRoot(document.body);
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: false });
  },
  deactivate() {
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    applyLocale(null); // 还原全部原文
    removeSwitcher();
    ctxRef = null;
  },
};

export default i18nMultilangPlugin;
