// Switch 插件 · 纯逻辑层（无 DOM / 无网络副作用，可在 Node 单测中直接引用）
// 负责：Agent 配置模型与校验、请求体构造、SSE 流解析、错误消息提取等。

import { presetById, type AgentType } from "./presets";

/* ---------------- 常量 ---------------- */

/** 系统提示词：把模型定义为 AgileCampus 的工作辅助 agent */
export const SYSTEM_PROMPT = [
  "你是「Switch 工作助手」，AgileCampus 敏捷校园平台内置的 AI 工作辅助 agent。",
  "你的能力包括：阅读并理解文档、提取与整理要点、总结归纳、多语言翻译（中/英/日/法/俄等）、基于材料答疑。",
  "规则：",
  "1. 使用与用户相同的语言回答。",
  "2. 阅读文档时忠于原文，不编造原文没有的内容；不确定处明确说明。",
  "3. 总结类任务先给一句话主旨，再列要点列表。",
  "4. 翻译任务只输出译文本身，除非用户要求解释或对比。",
  "5. 回答使用 Markdown，简洁、结构化。",
].join("\n");

/** 单条消息送入模型的字符上限（防超上下文；按需截断） */
export const MAX_MESSAGE_CHARS = 30_000;

/** 快捷指令模板（读文档为特殊流程，模板留空） */
export const QUICK_ACTIONS = [
  { key: "read-doc", label: "📖 读文档", template: "" },
  { key: "summarize", label: "📝 总结", template: "请总结以下内容：\n\n" },
  { key: "organize", label: "🧩 整理", template: "请把以下内容整理成结构化要点：\n\n" },
  { key: "translate", label: "🌐 翻译", template: "请翻译以下内容（请先说明目标语言，例如：翻译成英文）：\n\n" },
] as const;

/* ---------------- 配置模型 ---------------- */

export interface AgentConfig {
  id: string;
  /** 显示名，如「DeepSeek 主力」 */
  name: string;
  /** 来源预设 id（presets.ts）；保留以显示预设名与候选模型 */
  providerId: string;
  type: AgentType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 浏览器安全的新 Agent id（无 crypto.randomUUID 时降级） */
export function newAgentId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 由预设创建一份 Agent 配置草稿 */
export function createAgentFromPreset(presetId: string, name?: string): AgentConfig | null {
  const preset = presetById(presetId);
  if (!preset) return null;
  return {
    id: newAgentId(),
    name: name?.trim() || preset.name,
    providerId: preset.id,
    type: preset.type,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.defaultModel,
  };
}

/** 规范化 Base URL：去首尾空白、去结尾斜杠（防止双斜杠拼出 /v1//chat/completions） */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 是否需要 API Key（Ollama 本地可留空） */
export function apiKeyRequired(agent: Pick<AgentConfig, "providerId">): boolean {
  return !presetById(agent.providerId)?.apiKeyOptional;
}

/** 配置校验：返回中文错误文案；null 表示通过 */
export function validateAgent(agent: AgentConfig): string | null {
  if (!agent.name.trim()) return "请填写 Agent 名称";
  if (!normalizeBaseUrl(agent.baseUrl)) return "请填写 Base URL";
  if (apiKeyRequired(agent) && !agent.apiKey.trim()) return "请填写 API Key（本地 Ollama 可留空）";
  if (!agent.model.trim()) return "请填写模型名";
  return null;
}

/** API Key 打码显示：短 key 全打码；长 key 保留首 4 尾 4，中间最多 8 个 * */
export function maskApiKey(key: string): string {
  if (!key) return "（未填写）";
  if (key.length <= 8) return "****";
  const stars = "*".repeat(Math.min(key.length - 8, 8));
  return `${key.slice(0, 4)}${stars}${key.slice(-4)}`;
}

/** 序列化（storage 保存用） */
export function serializeAgents(agents: AgentConfig[]): string {
  return JSON.stringify(agents);
}

/** 容错解析：null / 坏 JSON → []；逐项过滤非法条目 */
export function parseAgents(raw: string | null): AgentConfig[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: AgentConfig[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const a = item as Partial<AgentConfig>;
    if (
      typeof a.id === "string" && a.id &&
      typeof a.name === "string" &&
      typeof a.providerId === "string" &&
      (a.type === "openai" || a.type === "anthropic") &&
      typeof a.baseUrl === "string" &&
      typeof a.apiKey === "string" &&
      typeof a.model === "string"
    ) {
      out.push({
        id: a.id,
        name: a.name,
        providerId: a.providerId,
        type: a.type,
        baseUrl: normalizeBaseUrl(a.baseUrl),
        apiKey: a.apiKey,
        model: a.model,
      });
    }
  }
  return out;
}

/** 超长文本截断（附省略标记，避免单条消息撑爆模型上下文） */
export function truncateText(text: string, max = MAX_MESSAGE_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…（内容过长已截断）`;
}

/* ---------------- 请求构造 ---------------- */

export interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI 兼容：system + 历史 + 逐条截断 */
export function buildOpenAiMessages(history: ChatMessage[]): OpenAiMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: truncateText(m.content) })),
  ];
}

export function buildOpenAiBody(agent: AgentConfig, messages: OpenAiMessage[], stream: boolean) {
  return { model: agent.model, messages, stream };
}

/** Anthropic Messages：system 独立字段；messages 只含 user/assistant */
export function buildAnthropicBody(agent: AgentConfig, history: ChatMessage[], stream: boolean) {
  return {
    model: agent.model,
    system: SYSTEM_PROMPT,
    messages: history.map((m) => ({ role: m.role, content: truncateText(m.content) })),
    max_tokens: 4096,
    stream,
  };
}

/** 请求地址：openai → {base}/chat/completions；anthropic → {base}/v1/messages */
export function endpointFor(agent: AgentConfig): string {
  const base = normalizeBaseUrl(agent.baseUrl);
  return agent.type === "anthropic" ? `${base}/v1/messages` : `${base}/chat/completions`;
}

/** 请求头：OpenAI 兼容走 Bearer；Anthropic 走 x-api-key + 浏览器直连声明头 */
export function requestHeadersFor(agent: AgentConfig): Record<string, string> {
  if (agent.type === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": agent.apiKey,
      "anthropic-version": "2023-06-01",
      // Anthropic 官方要求浏览器直连时显式声明，否则拒绝
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  return { "content-type": "application/json", authorization: `Bearer ${agent.apiKey}` };
}

/* ---------------- 错误与流解析 ---------------- */

/** 从 OpenAI / Anthropic 错误响应体中提取可读消息 */
export function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const err = obj.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
    if (typeof e.type === "string" && e.type) return e.type;
  }
  if (typeof obj.message === "string" && obj.message) return obj.message;
  return null;
}

/**
 * SSE 流解析器：按供应商协议解析文本增量。
 * - openai：`data: {"choices":[{"delta":{"content":"…"}}]}`，`data: [DONE]` 结束
 * - anthropic：`event: content_block_delta` + `data: {"delta":{"text_delta","text":"…"}}`，
 *   `message_stop` 结束
 * 字节流可任意分块（内部按行缓冲），返回每次 push 新增的文本增量数组。
 */
export class StreamParser {
  private buffer = "";
  private lastEvent = "";
  /** 解析到错误载荷后置位（服务商在流中返回错误） */
  error: string | null = null;
  /** 是否已收到结束标记 */
  done = false;
  readonly type: AgentType;

  constructor(type: AgentType) {
    this.type = type;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const deltas: string[] = [];
    let idx: number;
    while (!this.done && (idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      const delta = this.handleLine(line);
      if (delta) deltas.push(delta);
    }
    return deltas;
  }

  private handleLine(line: string): string | null {
    if (this.type === "openai") {
      if (!line.startsWith("data:")) return null;
      const payload = line.slice(5).trim();
      if (!payload) return null;
      if (payload === "[DONE]") {
        this.done = true;
        return null;
      }
      try {
        const obj = JSON.parse(payload) as Record<string, unknown>;
        const err = extractErrorMessage(obj);
        if (err) {
          this.error = err;
          this.done = true;
          return null;
        }
        const choices = obj.choices as Array<{ delta?: { content?: unknown } }> | undefined;
        const content = choices?.[0]?.delta?.content;
        return typeof content === "string" ? content : null;
      } catch {
        return null;
      }
    }
    // anthropic：先记 event 行，再处理 data 行
    if (line.startsWith("event:")) {
      this.lastEvent = line.slice(6).trim();
      return null;
    }
    if (!line.startsWith("data:")) return null;
    const payload = line.slice(5).trim();
    if (!payload) return null;
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const err = extractErrorMessage(obj);
      if (err) {
        this.error = err;
        this.done = true;
        return null;
      }
      if (obj.type === "message_stop") {
        this.done = true;
        return null;
      }
      if (obj.type === "content_block_delta") {
        const delta = obj.delta as { type?: string; text?: unknown } | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") return delta.text;
      }
      return null;
    } catch {
      return null;
    }
  }
}
