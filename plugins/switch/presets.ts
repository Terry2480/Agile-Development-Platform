// Switch 插件 · 供应商预设（类似 CC Switch 的内置 Provider 列表）
// 纯数据模块：不依赖 DOM，可在 Node 单测中直接引用。
// 预设只提供初始值；用户保存的 Agent 配置以 localStorage 为准。

export type AgentType = "openai" | "anthropic";

export interface ProviderPreset {
  /** 预设唯一标识（kebab-case） */
  id: string;
  /** 商城/设置界面显示名 */
  name: string;
  /** 协议类型：OpenAI 兼容（SSE data: 行）或 Anthropic Messages（SSE event: 行） */
  type: AgentType;
  /** API 基础地址（不含 /chat/completions 或 /v1/messages） */
  baseUrl: string;
  /** 常用模型候选（供 datalist 提示，可手输任意模型名） */
  models: string[];
  defaultModel: string;
  /** true 时 API Key 可留空（如本地 Ollama） */
  apiKeyOptional?: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "moonshot",
    name: "Moonshot Kimi",
    type: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2-turbo-preview", "moonshot-v1-8k"],
    defaultModel: "kimi-k2-turbo-preview",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    type: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus"],
    defaultModel: "glm-4-flash",
  },
  {
    id: "ollama",
    name: "Ollama 本地",
    type: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.1", "qwen2.5"],
    defaultModel: "llama3.1",
    apiKeyOptional: true,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
    defaultModel: "claude-3-5-haiku-latest",
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    type: "openai",
    baseUrl: "",
    models: [],
    defaultModel: "",
  },
];

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
