// Switch 插件纯逻辑单测：预设、配置校验与序列化、请求构造、SSE 流解析
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_PRESETS, presetById } from "@/plugins/switch/presets";
import {
  MAX_MESSAGE_CHARS, QUICK_ACTIONS, StreamParser, buildAnthropicBody, buildOpenAiBody,
  buildOpenAiMessages, createAgentFromPreset, endpointFor, extractErrorMessage, maskApiKey,
  newAgentId, normalizeBaseUrl, parseAgents, requestHeadersFor, serializeAgents, truncateText,
  validateAgent, type AgentConfig,
} from "@/plugins/switch/client";

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "a1",
    name: "主力",
    providerId: "deepseek",
    type: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-test-1234567890",
    model: "deepseek-chat",
    ...overrides,
  };
}

test("供应商预设：id 唯一、协议合法、模型候选非空", () => {
  const ids = PROVIDER_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "预设 id 重复");
  for (const p of PROVIDER_PRESETS) {
    assert.ok(p.type === "openai" || p.type === "anthropic", `${p.id} 协议非法`);
    if (p.id !== "custom") {
      assert.ok(p.baseUrl.trim().length > 0, `${p.id} baseUrl 为空`);
      assert.ok(p.defaultModel.trim().length > 0, `${p.id} defaultModel 为空`);
      assert.ok(p.models.length > 0, `${p.id} 无模型候选`);
    }
  }
  assert.equal(presetById("deepseek")?.name, "DeepSeek");
  assert.equal(presetById("nope"), undefined);
});

test("normalizeBaseUrl：去空白、去尾部斜杠", () => {
  assert.equal(normalizeBaseUrl("  https://api.deepseek.com/v1/  "), "https://api.deepseek.com/v1");
  assert.equal(normalizeBaseUrl("https://a.b///"), "https://a.b");
  assert.equal(normalizeBaseUrl(""), "");
});

test("createAgentFromPreset：按预设生成草稿，id 唯一", () => {
  const a = createAgentFromPreset("anthropic", "Claude 备用");
  assert.ok(a);
  assert.equal(a!.type, "anthropic");
  assert.equal(a!.name, "Claude 备用");
  assert.equal(a!.model, "claude-3-5-haiku-latest");
  assert.equal(a!.apiKey, "");
  const b = createAgentFromPreset("deepseek");
  assert.notEqual(a!.id, b!.id, "每次新建 id 应不同");
  assert.equal(createAgentFromPreset("missing"), null);
});

test("validateAgent：缺名称/地址/密钥/模型分别报错；Ollama 免密钥；合法配置通过", () => {
  assert.equal(validateAgent(agent({ name: "  " })), "请填写 Agent 名称");
  assert.equal(validateAgent(agent({ baseUrl: "  " })), "请填写 Base URL");
  assert.equal(validateAgent(agent({ apiKey: "" })), "请填写 API Key（本地 Ollama 可留空）");
  assert.equal(validateAgent(agent({ model: "" })), "请填写模型名");
  const ollama = agent({ providerId: "ollama", apiKey: "", baseUrl: "http://localhost:11434/v1", model: "llama3.1" });
  assert.equal(validateAgent(ollama), null);
  assert.equal(validateAgent(agent()), null);
});

test("maskApiKey：短 key 全打码，长 key 保留首尾", () => {
  assert.equal(maskApiKey(""), "（未填写）");
  assert.equal(maskApiKey("abcd1234"), "****");
  assert.equal(maskApiKey("sk-test-1234567890"), "sk-t********7890");
});

test("parseAgents：空值/坏 JSON/非数组容错；过滤非法条目并规范化地址", () => {
  assert.deepEqual(parseAgents(null), []);
  assert.deepEqual(parseAgents("{oops"), []);
  assert.deepEqual(parseAgents("{}"), []);
  assert.deepEqual(parseAgents(JSON.stringify([{ id: 1 }, null, "x", agent({ baseUrl: "https://a.b/" })])), [
    agent({ baseUrl: "https://a.b" }),
  ]);
});

test("serializeAgents 与 parseAgents 往返一致", () => {
  const list = [agent(), agent({ id: "a2", name: "备用", type: "anthropic", providerId: "anthropic", model: "claude-x" })];
  assert.deepEqual(parseAgents(serializeAgents(list)), list);
});

test("truncateText：超长截断并附标记，未超长原样返回", () => {
  assert.equal(truncateText("短文本", 10), "短文本");
  const out = truncateText("a".repeat(20), 10);
  assert.equal(out.length > 10, true);
  assert.ok(out.includes("已截断"));
});

test("buildOpenAiMessages：system 在前，历史保留角色，逐条截断", () => {
  const msgs = buildOpenAiMessages([
    { role: "user", content: "你好" },
    { role: "assistant", content: "在的" },
  ]);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes("Switch 工作助手"));
  assert.deepEqual(msgs.slice(1), [
    { role: "user", content: "你好" },
    { role: "assistant", content: "在的" },
  ]);
  const long = buildOpenAiMessages([{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 10) }]);
  assert.ok(long[1].content.length <= MAX_MESSAGE_CHARS + 30);
});

test("buildOpenAiBody：model / messages / stream 正确", () => {
  const body = buildOpenAiBody(agent(), [{ role: "user", content: "hi" }], true);
  assert.deepEqual(body, { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true });
});

test("buildAnthropicBody：system 独立字段 + max_tokens + stream", () => {
  const body = buildAnthropicBody(agent({ type: "anthropic" }), [{ role: "user", content: "hi" }], false);
  assert.equal(body.model, "deepseek-chat");
  assert.ok(body.system.includes("Switch 工作助手"));
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, false);
});

test("endpointFor：按协议拼接请求地址", () => {
  assert.equal(endpointFor(agent()), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(endpointFor(agent({ type: "anthropic", baseUrl: "https://api.anthropic.com/" })), "https://api.anthropic.com/v1/messages");
});

test("requestHeadersFor：OpenAI 走 Bearer，Anthropic 走 x-api-key + 浏览器直连声明", () => {
  const openai = requestHeadersFor(agent());
  assert.equal(openai.authorization, "Bearer sk-test-1234567890");
  assert.equal(openai["x-api-key"], undefined);
  const anthropic = requestHeadersFor(agent({ type: "anthropic" }));
  assert.equal(anthropic["x-api-key"], "sk-test-1234567890");
  assert.equal(anthropic["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(anthropic.authorization, undefined);
});

test("extractErrorMessage：兼容 openai/anthropic 错误结构与未知结构", () => {
  assert.equal(extractErrorMessage({ error: { message: "额度不足" } }), "额度不足");
  assert.equal(extractErrorMessage({ error: { type: "rate_limit_error" } }), "rate_limit_error");
  assert.equal(extractErrorMessage({ message: "boom" }), "boom");
  assert.equal(extractErrorMessage({}), null);
  assert.equal(extractErrorMessage(null), null);
});

test("StreamParser(openai)：任意分块、跳过心跳、识别 [DONE]", () => {
  const p = new StreamParser("openai");
  const deltas: string[] = [];
  deltas.push(...p.push('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choi'));
  deltas.push(...p.push('ces":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n'));
  deltas.push(...p.push('data: {"choices":[{"delta":{"content":"不应出现"}}]}\n'));
  assert.deepEqual(deltas, ["你", "好"]);
  assert.equal(p.done, true);
  assert.equal(p.error, null);
});

test("StreamParser(openai)：流内错误载荷置 error 并结束", () => {
  const p = new StreamParser("openai");
  assert.deepEqual(p.push('data: {"error":{"message":"token 失效"}}\n'), []);
  assert.equal(p.error, "token 失效");
  assert.equal(p.done, true);
});

test("StreamParser(anthropic)：按 event 过滤 delta，message_stop 结束", () => {
  const p = new StreamParser("anthropic");
  const deltas: string[] = [];
  deltas.push(...p.push('event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel'));
  deltas.push(...p.push('lo"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"x"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n'));
  assert.deepEqual(deltas, ["Hello"]);
  assert.equal(p.done, true);
});

test("快捷指令模板：四类入口齐全且模板非空（读文档为特殊流程）", () => {
  assert.deepEqual(QUICK_ACTIONS.map((q) => q.key), ["read-doc", "summarize", "organize", "translate"]);
  for (const q of QUICK_ACTIONS) {
    if (q.key !== "read-doc") assert.ok(q.template.length > 0, `${q.key} 模板为空`);
  }
});

test("newAgentId：格式合法且不重复", () => {
  const a = newAgentId();
  const b = newAgentId();
  assert.ok(a.length > 4);
  assert.notEqual(a, b);
});
