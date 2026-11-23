// 插件：Switch 工作助手（switch）
// ------------------------------------------------------------------
// 按 AgileCampus 插件标准格式实现（docs/PLUGIN-SPEC.md）。
// 能力：页面左下悬浮入口打开对话面板，作为 AI 工作辅助 agent：
//   · 文档阅读（直读平台云文档 /api/docs，api:read）、要点整理、内容总结
//   · 多语言翻译（中/英/日/法/俄等，随用户指令）
//   · 像 CC Switch 一样管理多个 LLM 供应商（预设 + 自定义 Base URL / API Key / 模型），一键切换
// 数据：Agent 配置仅存本机浏览器 localStorage（plugin.switch.*），请求直连供应商，不经过平台服务器。
// 停用：卸载全部 UI、断开全部监听、中止进行中的请求，页面无残留。
"use client";

import type { AgileCampusPlugin, PluginContext } from "@/lib/plugins/types";
import {
  QUICK_ACTIONS, StreamParser, buildAnthropicBody, buildOpenAiBody, buildOpenAiMessages,
  createAgentFromPreset, endpointFor, extractErrorMessage, maskApiKey, newAgentId,
  parseAgents, requestHeadersFor, serializeAgents, truncateText, validateAgent,
  type AgentConfig, type ChatMessage,
} from "./client";
import { PROVIDER_PRESETS, presetById } from "./presets";
import { SWITCH_CSS } from "./style";

type DocListItem = { id: number; projectName: string; title: string; excerpt: string | null };
type DocDetail = { doc: { title: string; content: string } };

const STYLE_ID = "sw-plugin-style";
const MAX_HISTORY = 12; // 上下文里最多保留的消息条数

/* ---------------- 模块级状态（插件激活期间有效） ---------------- */

let ctxRef: PluginContext | null = null;
let launcher: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let chatView: HTMLElement | null = null;
let settingsView: HTMLElement | null = null;
let docsView: HTMLElement | null = null;
let toast: HTMLElement | null = null;
let agentSelect: HTMLSelectElement | null = null;
let messagesEl: HTMLElement | null = null;
let composer: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let settingsList: HTMLElement | null = null;
let agentForm: HTMLElement | null = null;
let formTitle: HTMLElement | null = null;
let docListEl: HTMLElement | null = null;
let modelDatalist: HTMLDataListElement | null = null;

let agents: AgentConfig[] = [];
let history: ChatMessage[] = [];
let editingId: string | null = null;
let controller: AbortController | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const listeners: Array<{ target: EventTarget; type: string; fn: EventListener }> = [];
function on(target: EventTarget, type: string, fn: EventListener) {
  target.addEventListener(type, fn);
  listeners.push({ target, type, fn });
}
function offAll() {
  for (const l of listeners) l.target.removeEventListener(l.type, l.fn);
  listeners.length = 0;
}

/* ---------------- 工具 ---------------- */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(text: string, isError = false) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.toggle("sw-toast--error", isError);
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast) toast.hidden = true;
    toastTimer = null;
  }, 3200);
}

function loadAgents() {
  agents = parseAgents(ctxRef?.storage.get("agents") ?? null);
}
function saveAgents() {
  ctxRef?.storage.set("agents", serializeAgents(agents));
}
function activeAgent(): AgentConfig | undefined {
  const id = ctxRef?.storage.get("activeAgentId") ?? null;
  return agents.find((a) => a.id === id) ?? agents[0];
}
function setActiveId(id: string) {
  ctxRef?.storage.set("activeAgentId", id);
}

function showView(view: "chat" | "settings" | "docs") {
  if (chatView) chatView.hidden = view !== "chat";
  if (settingsView) settingsView.hidden = view !== "settings";
  if (docsView) docsView.hidden = view !== "docs";
}

/* ---------------- 界面搭建 ---------------- */

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SWITCH_CSS;
  document.head.appendChild(style);
}

function buildLauncher() {
  if (launcher?.isConnected) return;
  launcher = el("button", "sw-launcher");
  launcher.type = "button";
  launcher.title = "Switch 工作助手";
  launcher.setAttribute("aria-label", "打开 Switch 工作助手");
  launcher.append(el("span", "sw-launcher__dot"), document.createTextNode("Switch"));
  on(launcher, "click", () => {
    if (panel?.hidden) openPanel();
    else closePanel();
  });
  document.body.appendChild(launcher);
}

function openPanel() {
  if (!panel) return;
  panel.hidden = false;
  composer?.focus();
}
function closePanel() {
  if (panel) panel.hidden = true;
}

function renderAgentSelect() {
  if (!agentSelect) return;
  const active = activeAgent();
  agentSelect.replaceChildren();
  if (agents.length === 0) {
    agentSelect.append(el("option", undefined, "未配置 Agent"));
    return;
  }
  for (const a of agents) {
    const opt = el("option", undefined, a.name);
    opt.value = a.id;
    if (active?.id === a.id) opt.selected = true;
    agentSelect.appendChild(opt);
  }
}

function renderEmptyHint() {
  if (!messagesEl) return;
  messagesEl.replaceChildren();
  const wrap = el("div", "sw-empty");
  wrap.append(
    el("div", undefined, "🛰️ 尚未配置 Agent"),
    el("div", undefined, "添加一个供应商（API Key + 模型），即可像 CC Switch 一样随时切换。"),
  );
  const btn = el("button", "sw-mini-btn", "去配置");
  on(btn, "click", () => openSettings());
  wrap.appendChild(btn);
  messagesEl.appendChild(wrap);
}

function renderMessage(role: "user" | "assistant", content: string): HTMLElement {
  const wrap = el("div", `sw-msg sw-msg--${role}`);
  const body = el("div", "sw-msg__body");
  body.textContent = content;
  wrap.appendChild(body);
  messagesEl?.appendChild(wrap);
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

function updateModelDatalist() {
  if (!modelDatalist || !agentForm) return;
  const presetId = (agentForm.querySelector<HTMLSelectElement>(".sw-form__preset")?.value ?? "");
  const preset = presetById(presetId);
  modelDatalist.replaceChildren();
  for (const m of preset?.models ?? []) {
    const opt = el("option");
    opt.value = m;
    modelDatalist.appendChild(opt);
  }
}

/* ---------------- 设置视图 ---------------- */

function openSettings() {
  renderSettingsList();
  closeAgentForm();
  showView("settings");
}

function closeSettings() {
  showView("chat");
}

function renderSettingsList() {
  if (!settingsList) return;
  settingsList.replaceChildren();
  const active = activeAgent();
  for (const a of agents) {
    const item = el("div", `sw-agent-item${active?.id === a.id ? " sw-agent-item--active" : ""}`);
    const row = el("div", "sw-agent-item__row");
    row.append(el("span", "sw-active-dot", active?.id === a.id ? "● 使用中" : "○"), el("span", "sw-agent-item__name", a.name));
    const ops = el("div", "sw-agent-item__ops");
    const editBtn = el("button", "sw-mini-btn", "编辑");
    const testBtn = el("button", "sw-mini-btn", "测试");
    const delBtn = el("button", "sw-mini-btn sw-mini-btn--danger", "删除");
    ops.append(editBtn, testBtn, delBtn);
    row.appendChild(ops);
    item.appendChild(row);
    const preset = presetById(a.providerId);
    item.appendChild(el("div", "sw-agent-item__meta",
      `${preset?.name ?? a.providerId} · ${a.model} · Key ${maskApiKey(a.apiKey)}`));
    on(item, "click", () => {
      setActiveId(a.id);
      renderAgentSelect();
      renderSettingsList();
      setStatus(`已切换到 ${a.name}`);
    });
    on(editBtn, "click", (e) => {
      e.stopPropagation();
      openAgentForm(a);
    });
    on(testBtn, "click", (e) => {
      e.stopPropagation();
      void testAgent(a, testBtn);
    });
    on(delBtn, "click", (e) => {
      e.stopPropagation();
      if (!window.confirm(`删除 Agent「${a.name}」？`)) return;
      agents = agents.filter((x) => x.id !== a.id);
      if (active?.id === a.id) setActiveId("");
      saveAgents();
      renderAgentSelect();
      renderSettingsList();
      if (agents.length === 0) renderEmptyHint();
    });
    settingsList.appendChild(item);
  }
  const addBtn = el("button", "sw-add-btn", "＋ 添加 Agent");
  on(addBtn, "click", () => openAgentForm());
  settingsList.appendChild(addBtn);
}

function openAgentForm(existing?: AgentConfig) {
  if (!agentForm) return;
  editingId = existing?.id ?? null;
  if (formTitle) formTitle.textContent = existing ? `编辑 Agent：${existing.name}` : "新增 Agent";
  const nameInput = agentForm.querySelector<HTMLInputElement>(".sw-form__name");
  const presetSelect = agentForm.querySelector<HTMLSelectElement>(".sw-form__preset");
  const baseInput = agentForm.querySelector<HTMLInputElement>(".sw-form__base");
  const keyInput = agentForm.querySelector<HTMLInputElement>(".sw-form__key");
  const modelInput = agentForm.querySelector<HTMLInputElement>(".sw-form__model");
  const hint = agentForm.querySelector<HTMLElement>(".sw-form__hint");
  if (!nameInput || !presetSelect || !baseInput || !keyInput || !modelInput) return;
  presetSelect.replaceChildren();
  for (const p of PROVIDER_PRESETS) {
    const opt = el("option", undefined, p.name);
    opt.value = p.id;
    presetSelect.appendChild(opt);
  }
  const source = existing ?? createAgentFromPreset("deepseek");
  if (!source) return;
  presetSelect.value = source.providerId;
  nameInput.value = existing ? existing.name : "";
  baseInput.value = existing ? existing.baseUrl : source.baseUrl;
  keyInput.value = existing ? existing.apiKey : "";
  modelInput.value = existing ? existing.model : source.model;
  if (hint) hint.textContent = presetById(source.providerId)?.apiKeyOptional
    ? "本地 Ollama 可留空 API Key。"
    : "API Key 仅保存在本机浏览器，不会上传平台服务器。";
  updateModelDatalist();
  agentForm.hidden = false;
  nameInput.focus();
}

function closeAgentForm() {
  if (agentForm) agentForm.hidden = true;
  editingId = null;
}

function saveAgentFromForm() {
  if (!agentForm) return;
  const nameInput = agentForm.querySelector<HTMLInputElement>(".sw-form__name");
  const presetSelect = agentForm.querySelector<HTMLSelectElement>(".sw-form__preset");
  const baseInput = agentForm.querySelector<HTMLInputElement>(".sw-form__base");
  const keyInput = agentForm.querySelector<HTMLInputElement>(".sw-form__key");
  const modelInput = agentForm.querySelector<HTMLInputElement>(".sw-form__model");
  if (!nameInput || !presetSelect || !baseInput || !keyInput || !modelInput) return;
  const preset = presetById(presetSelect.value);
  if (!preset) {
    setStatus("请选择供应商预设", true);
    return;
  }
  const draft: AgentConfig = {
    id: editingId ?? newAgentId(),
    name: nameInput.value.trim(),
    providerId: preset.id,
    type: preset.type,
    baseUrl: baseInput.value.trim(),
    apiKey: keyInput.value.trim(),
    model: modelInput.value.trim(),
  };
  const err = validateAgent(draft);
  if (err) {
    setStatus(err, true);
    return;
  }
  const index = agents.findIndex((a) => a.id === draft.id);
  if (index >= 0) agents[index] = draft;
  else agents.push(draft);
  saveAgents();
  if (!ctxRef?.storage.get("activeAgentId") && agents.length === 1) setActiveId(draft.id);
  closeAgentForm();
  renderSettingsList();
  renderAgentSelect();
  if (messagesEl && messagesEl.querySelector(".sw-empty")) {
    messagesEl.replaceChildren();
  }
  setStatus(`已保存 ${draft.name}`);
}

async function testAgent(a: AgentConfig, btn: HTMLButtonElement) {
  const old = btn.textContent;
  btn.textContent = "测试中…";
  btn.disabled = true;
  try {
    const res = await fetch(endpointFor(a), {
      method: "POST",
      headers: requestHeadersFor(a),
      body: a.type === "anthropic"
        ? JSON.stringify({ model: a.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] })
        : JSON.stringify({ model: a.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    if (res.ok) setStatus("连接成功：服务商可达，模型可用");
    else setStatus(`连接失败：${await readApiError(res)}`, true);
  } catch (e) {
    setStatus(friendlyError(e) || "连接失败", true);
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
}

/* ---------------- 文档阅读 ---------------- */

async function openDocPicker() {
  if (!activeAgent()) {
    openSettings();
    setStatus("请先配置并选择 Agent", true);
    return;
  }
  showView("docs");
  if (!docListEl) return;
  docListEl.replaceChildren(el("div", "sw-doc-empty", "加载中…"));
  try {
    const data = await ctxRef!.api<{ docs: DocListItem[] }>("/api/docs");
    docListEl.replaceChildren();
    if (data.docs.length === 0) {
      docListEl.appendChild(el("div", "sw-doc-empty", "还没有云文档。可先在项目里创建文档，或直接粘贴内容到输入框。"));
      return;
    }
    for (const d of data.docs) {
      const item = el("button", "sw-doc-item");
      item.type = "button";
      item.append(
        el("b", undefined, d.title),
        el("small", undefined, `${d.projectName} · ${(d.excerpt ?? "").slice(0, 60) || "（空文档）"}`),
      );
      on(item, "click", () => void pickDoc(d.id, d.title));
      docListEl.appendChild(item);
    }
  } catch (e) {
    docListEl.replaceChildren(el("div", "sw-doc-empty", `读取文档列表失败：${friendlyError(e)}（需登录平台）`));
  }
}

async function pickDoc(id: number, title: string) {
  if (!docListEl) return;
  docListEl.replaceChildren(el("div", "sw-doc-empty", "读取文档中…"));
  try {
    const data = await ctxRef!.api<DocDetail>(`/api/docs/${id}`);
    const prompt = [
      "请阅读下面的平台云文档，并完成：",
      "1) 一句话主旨；2) 要点列表；3) 可执行的下一步建议。",
      "",
      `【文档标题】${data.doc.title}`,
      "",
      "【正文】",
      truncateText(data.doc.content),
    ].join("\n");
    showView("chat");
    void sendNow(prompt);
  } catch (e) {
    docListEl.replaceChildren(el("div", "sw-doc-empty", `读取文档《${title}》失败：${friendlyError(e)}`));
  }
}

/* ---------------- 对话与请求 ---------------- */

function setSending(sending: boolean) {
  if (!sendBtn) return;
  sendBtn.textContent = sending ? "■ 停止" : "发送";
  sendBtn.classList.toggle("sw-send--stop", sending);
  if (composer) composer.disabled = sending;
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const msg = extractErrorMessage(data);
    if (msg) return msg;
  } catch { /* 忽略 */ }
  return `服务商返回 ${res.status}`;
}

function friendlyError(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") return "";
  if (e instanceof TypeError) return "无法连接到服务商：网络问题或服务商不允许浏览器直连（CORS 限制）。可尝试 DeepSeek / OpenAI / 本地 Ollama，或使用允许浏览器访问的接口。";
  if (e instanceof Error && e.message) return e.message;
  return "请求失败，请重试";
}

async function streamOpenAi(agent: AgentConfig, body: HTMLElement, signal: AbortSignal) {
  const res = await fetch(endpointFor(agent), {
    method: "POST",
    headers: requestHeadersFor(agent),
    body: JSON.stringify(buildOpenAiBody(agent, buildOpenAiMessages(history), true)),
    signal,
  });
  if (!res.ok) throw new Error(await readApiError(res));
  const reader = res.body?.getReader();
  if (!reader) {
    // 服务商不支持流式：读一次性返回
    const data = await res.json().catch(() => null);
    const content = (data as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content ?? "";
    body.textContent = content;
    return;
  }
  const parser = new StreamParser("openai");
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const d of parser.push(dec.decode(value, { stream: true }))) body.textContent += d;
  }
  if (parser.error) throw new Error(parser.error);
}

async function streamAnthropic(agent: AgentConfig, body: HTMLElement, signal: AbortSignal) {
  const res = await fetch(endpointFor(agent), {
    method: "POST",
    headers: requestHeadersFor(agent),
    body: JSON.stringify(buildAnthropicBody(agent, history, true)),
    signal,
  });
  if (!res.ok) throw new Error(await readApiError(res));
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    const blocks = (data as { content?: Array<{ type?: string; text?: string }> } | null)?.content ?? [];
    body.textContent = blocks.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
    return;
  }
  const parser = new StreamParser("anthropic");
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const d of parser.push(dec.decode(value, { stream: true }))) body.textContent += d;
  }
  if (parser.error) throw new Error(parser.error);
}

async function sendNow(presetText?: string) {
  const text = (presetText ?? composer?.value ?? "").trim();
  if (!text) return;
  const agent = activeAgent();
  if (!agent) {
    openSettings();
    setStatus("请先配置一个 Agent（API Key + 模型）", true);
    return;
  }
  if (composer && !presetText) composer.value = "";
  history.push({ role: "user", content: text });
  history = history.slice(-MAX_HISTORY);
  renderMessage("user", text);
  const wrap = renderMessage("assistant", "");
  const body = wrap.querySelector<HTMLElement>(".sw-msg__body");
  if (!body) return;
  body.classList.add("sw-msg__body--typing");
  controller = new AbortController();
  setSending(true);
  try {
    if (agent.type === "anthropic") await streamAnthropic(agent, body, controller.signal);
    else await streamOpenAi(agent, body, controller.signal);
    const out = body.textContent ?? "";
    history.push({ role: "assistant", content: out });
    if (!out.trim()) body.textContent = "（未返回内容）";
  } catch (e) {
    const msg = friendlyError(e);
    if (msg) {
      const prefix = (body.textContent ?? "").trim() ? "\n\n" : "";
      body.textContent += `${prefix}⚠️ ${msg}`;
    }
  } finally {
    body.classList.remove("sw-msg__body--typing");
    body.classList.toggle("sw-msg__body--error", body.textContent.includes("⚠️"));
    controller = null;
    setSending(false);
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

/* ---------------- 生命周期 ---------------- */

export const switchPlugin: AgileCampusPlugin = {
  id: "switch",
  name: "Switch 工作助手",
  version: "1.0.0",
  author: "AgileCampus 团队",
  description: "可接入任意 LLM 供应商的 AI 工作辅助 agent：文档阅读/整理/总结、多语言翻译；像 CC Switch 一样管理多个 API Key 并一键切换。",
  category: "integration",
  icon: "⚡",
  permissions: ["ui:mount", "storage:local", "api:read", "network:external"],
  activate(ctx) {
    // 幂等：重复激活前先完整清理
    switchPlugin.deactivate?.();
    ctxRef = ctx;
    loadAgents();
    ensureStyle();
    buildLauncher();

    panel = el("div", "sw-panel");
    panel.hidden = true;

    // 顶栏：标题 + Agent 切换 + 设置 + 关闭
    const head = el("div", "sw-head");
    const title = el("div", "sw-head__title", "⚡ Switch 工作助手");
    title.title = `宿主 v${ctx.hostVersion}`;
    agentSelect = el("select", "sw-agent-select");
    agentSelect.setAttribute("aria-label", "切换 Agent");
    on(agentSelect, "change", () => {
      setActiveId(agentSelect!.value);
      renderSettingsList();
      setStatus(`已切换到 ${activeAgent()?.name ?? "…"}`);
    });
    const gear = el("button", "sw-icon-btn", "⚙");
    gear.type = "button";
    gear.title = "管理 Agent";
    on(gear, "click", () => openSettings());
    const close = el("button", "sw-icon-btn", "✕");
    close.type = "button";
    close.title = "关闭";
    on(close, "click", () => closePanel());
    head.append(title, agentSelect, gear, close);
    panel.appendChild(head);

    // 对话视图
    chatView = el("div", "sw-view");
    const chips = el("div", "sw-chips");
    for (const qa of QUICK_ACTIONS) {
      const chip = el("button", "sw-chip", qa.label);
      chip.type = "button";
      on(chip, "click", () => {
        if (qa.key === "read-doc") void openDocPicker();
        else {
          if (!composer) return;
          composer.value = qa.template;
          composer.focus();
        }
      });
      chips.appendChild(chip);
    }
    messagesEl = el("div", "sw-messages");
    const composerRow = el("div", "sw-composer");
    composer = el("textarea", "sw-input");
    composer.rows = 1;
    composer.placeholder = "输入任务，如「翻译成英文：你好」；Enter 发送，Shift+Enter 换行";
    on(composer, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        void sendNow();
      }
    });
    sendBtn = el("button", "sw-send", "发送");
    sendBtn.type = "button";
    on(sendBtn, "click", () => {
      if (controller) {
        controller.abort();
        return;
      }
      void sendNow();
    });
    composerRow.append(composer, sendBtn);
    chatView.append(chips, messagesEl, composerRow);
    panel.appendChild(chatView);

    // 设置视图
    settingsView = el("div", "sw-view");
    const settingsHead = el("div", "sw-subhead");
    const backBtn = el("button", "sw-mini-btn", "← 返回对话");
    backBtn.type = "button";
    on(backBtn, "click", () => closeSettings());
    settingsHead.append(backBtn, el("b", undefined, "Agent 管理"));
    settingsList = el("div", "sw-list");
    agentForm = el("div", "sw-form");
    agentForm.hidden = true;
    formTitle = el("b", undefined, "新增 Agent");
    const nameField = el("div", "sw-field");
    nameField.append(el("label", undefined, "名称"), (() => {
      const input = el("input", "sw-form__name");
      input.type = "text";
      input.placeholder = "如：DeepSeek 主力";
      input.maxLength = 30;
      return input;
    })());
    const presetField = el("div", "sw-field");
    presetField.append(el("label", undefined, "供应商预设"), (() => {
      const select = el("select", "sw-form__preset");
      on(select, "change", () => {
        const preset = presetById(select.value);
        const base = agentForm?.querySelector<HTMLInputElement>(".sw-form__base");
        const model = agentForm?.querySelector<HTMLInputElement>(".sw-form__model");
        const hint = agentForm?.querySelector<HTMLElement>(".sw-form__hint");
        if (!preset) return;
        if (base && !base.value.trim()) base.value = preset.baseUrl;
        if (model) model.placeholder = preset.defaultModel || "模型名";
        if (hint) hint.textContent = preset.apiKeyOptional
          ? "本地 Ollama 可留空 API Key。"
          : "API Key 仅保存在本机浏览器，不会上传平台服务器。";
        updateModelDatalist();
      });
      return select;
    })());
    const baseField = el("div", "sw-field");
    baseField.append(el("label", undefined, "Base URL"), (() => {
      const input = el("input", "sw-form__base");
      input.type = "text";
      input.placeholder = "如 https://api.deepseek.com/v1";
      return input;
    })());
    const keyField = el("div", "sw-field");
    keyField.append(el("label", undefined, "API Key"), (() => {
      const input = el("input", "sw-form__key");
      input.type = "password";
      input.placeholder = "sk-…";
      input.autocomplete = "off";
      return input;
    })());
    const modelField = el("div", "sw-field");
    modelField.append(el("label", undefined, "模型"), (() => {
      const input = el("input", "sw-form__model");
      input.type = "text";
      input.placeholder = "模型名，可手输";
      modelDatalist = el("datalist");
      modelDatalist.id = "sw-model-list";
      input.setAttribute("list", modelDatalist.id);
      agentForm?.appendChild(modelDatalist);
      return input;
    })());
    const hint = el("div", "sw-form__hint");
    hint.className = "sw-form__hint";
    hint.style.cssText = "font-size:11px;color:var(--ws-color-c6cbdb,#c6cbdb)";
    const ops = el("div", "sw-form__ops");
    const saveBtn = el("button", "sw-send", "保存");
    saveBtn.type = "button";
    on(saveBtn, "click", () => saveAgentFromForm());
    const cancelBtn = el("button", "sw-mini-btn", "取消");
    cancelBtn.type = "button";
    on(cancelBtn, "click", () => closeAgentForm());
    ops.append(saveBtn, cancelBtn);
    agentForm.append(formTitle, nameField, presetField, baseField, keyField, modelField, hint, ops);
    settingsView.append(settingsHead, settingsList, agentForm, el("div", "sw-foot-note",
      `Switch ${switchPlugin.version} · 宿主 v${ctx.hostVersion} · 配置仅存本机浏览器（localStorage），请求直连供应商，平台服务器不接触 API Key。请勿在公共电脑保存真实密钥。`));
    panel.appendChild(settingsView);

    // 文档选择视图
    docsView = el("div", "sw-view");
    const docsHead = el("div", "sw-subhead");
    const docsBack = el("button", "sw-mini-btn", "← 返回对话");
    docsBack.type = "button";
    on(docsBack, "click", () => showView("chat"));
    docsHead.append(docsBack, el("b", undefined, "选择要阅读的平台文档"));
    docListEl = el("div", "sw-list");
    docsView.append(docsHead, docListEl);
    panel.appendChild(docsView);

    toast = el("div", "sw-toast");
    toast.hidden = true;
    panel.appendChild(toast);

    document.body.appendChild(panel);

    // 全局交互：Esc 关闭、点击面板外关闭
    on(document, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") closePanel();
    });
    on(document, "click", (e) => {
      if (panel && !panel.hidden && !panel.contains(e.target as Node) && !launcher?.contains(e.target as Node)) {
        closePanel();
      }
    });

    renderAgentSelect();
    if (agents.length === 0) renderEmptyHint();
  },
  deactivate() {
    controller?.abort();
    controller = null;
    offAll();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    launcher?.remove();
    panel?.remove();
    document.getElementById(STYLE_ID)?.remove();
    launcher = null;
    panel = null;
    chatView = null;
    settingsView = null;
    docsView = null;
    toast = null;
    agentSelect = null;
    messagesEl = null;
    composer = null;
    sendBtn = null;
    settingsList = null;
    agentForm = null;
    formTitle = null;
    docListEl = null;
    modelDatalist = null;
    agents = [];
    history = [];
    editingId = null;
    ctxRef = null;
  },
};

export default switchPlugin;
