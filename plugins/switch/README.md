# Switch 工作助手（switch）

按 AgileCampus 插件标准格式（`docs/PLUGIN-SPEC.md`）实现的内置插件。启用后页面左下角出现「Switch」悬浮入口，打开对话面板即可使用。

## 功能说明

Switch 是一个 AI 工作辅助 agent，能力包括（但不限于）：

- **文档阅读 / 整理 / 总结**：「📖 读文档」快捷入口可直接读取平台云文档（`GET /api/docs`、`GET /api/docs/[id]`），由 Agent 输出一句话主旨、要点列表与下一步建议；也可以直接粘贴内容，用「📝 总结」「🧩 整理」模板处理。
- **多语言翻译**：「🌐 翻译」模板支持中/英/日/法/俄等语言互译，目标语言随用户指令。
- **多 Agent 接入（类 CC Switch）**：管理多个 LLM 供应商配置——名称、预设（DeepSeek / OpenAI / Moonshot Kimi / 智谱 GLM / Ollama 本地 / Anthropic Claude / 自定义 OpenAI 兼容）、Base URL、API Key、模型；在面板顶部下拉或设置页一键切换，支持「测试」连通性校验。
- **流式输出**：OpenAI 兼容协议（SSE `data:` 行）与 Anthropic Messages（SSE `event:` 行）两种协议均支持流式打字机输出，可中途停止。

## 权限用途

| 权限 | 用途 |
|---|---|
| `ui:mount` | 挂载悬浮入口、对话面板、设置与文档选择界面；停用时全部移除 |
| `storage:local` | 在 `plugin.switch.*` 命名空间保存 Agent 配置（含 API Key）与当前选用项 |
| `api:read` | 以当前登录态只读调用平台接口：`GET /api/docs`、`GET /api/docs/[id]`（用于文档阅读） |
| `network:external` | 浏览器直连用户配置的 LLM 供应商地址（chat/completions、v1/messages） |

## 数据与安全

- Agent 配置（含 API Key）**仅保存在本机浏览器 localStorage**，请求由浏览器直连供应商；平台服务器不接触、不转发、不存储 API Key。
- 请勿在公共电脑保存真实密钥；停用插件不会删除配置（用户数据保留），可随时重新启用。
- 部分服务商不允许浏览器跨域直连（CORS），连接失败时面板会给出提示；DeepSeek / OpenAI / 本地 Ollama 可直接使用。

## 测试记录

- 单测：`tests/switch.test.ts`（19 个用例，覆盖预设完整性、配置校验/序列化容错、请求体构造、两种协议的 SSE 流解析、错误消息提取）。
- 执行方式：`npm test`（node --test + tsx，无需数据库）。
- 本插件不修改 `app/`、`components/` 下任何平台文件；仅注册于 `lib/plugins/registry.ts`。

## 使用说明

1. 打开「插件商城」（/plugins），启用「Switch 工作助手」。
2. 点击页面左下角「Switch」打开面板 → ⚙ 设置 →「＋ 添加 Agent」，选择预设并填写 Base URL / API Key / 模型，保存。
3. 面板顶部下拉选择当前 Agent（一键切换），输入任务或使用快捷指令。
