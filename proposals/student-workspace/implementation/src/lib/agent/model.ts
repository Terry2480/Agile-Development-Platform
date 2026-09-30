import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";

// DeepSeek 已废弃 deepseek-chat 番号（现返 400 invalid_request_error），现行为 v4 系列。
// flash 迅捷省耗，适配项目管理助手的短问答+工具调用；重推理可经 DEEPSEEK_MODEL 换 deepseek-v4-pro。
const DEFAULT_MODEL = "deepseek-v4-flash";

// 仅在生产（route 未注入 model）时调用；测试注入 MockLanguageModelV2，不触达此函数
export function getModel(): LanguageModel {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AppError("DeepSeek 未配置：请在 .env 设置 DEEPSEEK_API_KEY");
  const deepseek = createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return deepseek(process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL);
}
