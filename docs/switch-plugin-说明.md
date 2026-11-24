# Switch 工作助手插件说明

> 版本：1.0.0 · 上架于插件商城（/plugins）· 标准格式见 `docs/PLUGIN-SPEC.md`

Switch 是平台内置的 AI 工作辅助 agent 插件，定位类似 [CC Switch](https://github.com/kongkongyo/cc-switch) 在编码工具中的角色：**把多个 LLM 供应商（API Key + Base URL + 模型）统一收口，一键切换**，并在平台内提供文档阅读整理总结、语言翻译等助手能力。

## 一、功能

| 能力 | 说明 |
|---|---|
| 📖 读文档 | 直读平台云文档（`GET /api/docs` → `GET /api/docs/[id]`），输出一句话主旨、要点列表、下一步建议 |
| 📝 总结 / 🧩 整理 | 对粘贴内容做总结归纳或结构化整理 |
| 🌐 翻译 | 中/英/日/法/俄等多语言互译，目标语言随指令（如「翻译成英文：…」） |
| 🔌 多 Agent 接入 | 预设 DeepSeek / OpenAI / Moonshot Kimi / 智谱 GLM / Ollama 本地 / Anthropic Claude / 自定义 OpenAI 兼容；可增删改、测试连通、一键切换 |
| ⚡ 流式输出 | OpenAI 兼容与 Anthropic Messages 两种协议均流式打字机输出，可中途停止 |

## 二、使用步骤

1. 打开「插件商城」（`/plugins`），启用「Switch 工作助手」。
2. 点击**工作台左侧功能列队尾**的「⚡ Switch」按钮打开面板 → ⚙ → 「＋ 添加 Agent」：选择预设，填写名称、Base URL、API Key、模型，保存。
3. 面板顶部下拉选择当前 Agent（弹出式列表，超过 4 行可滚动）；输入任务或点快捷指令（📖 读文档会弹出平台文档列表）；输入栏随内容自动增高。

## 三、数据与安全

- 配置（含 API Key）仅存本机浏览器 localStorage（`plugin.switch.*` 命名空间），**请求由浏览器直连供应商，平台服务器不接触 API Key**。
- 请勿在公共电脑保存真实密钥；停用插件不删除配置。
- 供应商返回的错误（额度、鉴权失败等）会原样显示在气泡中；浏览器 CORS 限制会给出提示（DeepSeek / OpenAI / 本地 Ollama 可直接使用）。

## 四、实现结构

```
plugins/switch/
  plugin.ts      # 主插件：栏位事件入口、对话面板、设置与文档选择 UI、生命周期
  client.ts      # 纯逻辑：配置模型/校验/序列化、请求构造、SSE 流解析、错误提取
  presets.ts     # 供应商预设数据
  style.ts       # 注入式样式（昼夜双套控件对比度，--ws-color 令牌）
  README.md      # 插件说明（规范要求）
tests/switch.test.ts   # 19 个单测用例
```

权限声明：`ui:mount`、`storage:local`、`api:read`、`network:external`（各权限用途见插件 README）。
栏位入口：manifest 声明 `railEntry: { icon: "⚡", label: "Switch" }`——宿主在插件启用时把图标渲染进左侧功能列队尾（云文档之后），点击派发 `agilecampus-plugin-rail` 事件由插件开合面板；不声明该字段的插件（如多语言）不占栏位。

## 五、验证

```bash
npm test                # 全部测试（含 tests/switch.test.ts）
npx tsc --noEmit        # 类型检查
npx eslint plugins/switch tests/switch.test.ts
```

停用验收：面板/入口/样式全部移除、监听断开、进行中的请求中止，页面无残留（符合 PLUGIN-SPEC 停用还原标准）。
