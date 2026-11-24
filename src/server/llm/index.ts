import { OpenAiCompatibleProvider, type StructuredMode } from "./openai-compatible";
import type { LlmProvider } from "./types";

export * from "./types";
export * from "./pricing";
export { OpenAiCompatibleProvider, extractJsonText } from "./openai-compatible";
export { MockProvider } from "./mock";

/** OpenAI-совместимый endpoint AI Studio. */
export const AI_STUDIO_BASE_URL = "https://ai.api.cloud.yandex.net/v1";
/** Модель по умолчанию — победитель эвала извлечения (scripts/eval-models.ts). */
export const DEFAULT_LLM_MODEL = "deepseek-v4.1-flash";

type Env = Record<string, string | undefined>;

/** Короткое имя модели («qwen3.6-35b-a3b») → URI AI Studio (gpt://<folder>/<model>/latest). */
export function aiStudioModelUri(model: string, folderId: string): string {
  if (model.includes("://")) return model;
  return `gpt://${folderId}/${model.includes("/") ? model : `${model}/latest`}`;
}

/**
 * Провайдер из переменных окружения: YANDEX_API_KEY, YANDEX_FOLDER_ID, LLM_MODEL,
 * необязательные LLM_BASE_URL (другой OpenAI-совместимый endpoint; ключ тогда в LLM_API_KEY)
 * и LLM_STRUCTURED_MODE.
 * null — ключа нет (живой режим недоступен, вызывающий код переходит на демо).
 */
export function createLlmProviderFromEnv(env: Env = process.env): LlmProvider | null {
  const baseUrl = env.LLM_BASE_URL?.trim() || AI_STUDIO_BASE_URL;
  const isAiStudio = baseUrl.includes("api.cloud.yandex.net");
  const apiKey = (isAiStudio ? env.YANDEX_API_KEY : env.LLM_API_KEY)?.trim();
  const folderId = env.YANDEX_FOLDER_ID?.trim() ?? "";
  if (!apiKey || (isAiStudio && !folderId)) return null;
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  return new OpenAiCompatibleProvider({
    baseUrl,
    apiKey,
    model: isAiStudio ? aiStudioModelUri(model, folderId) : model,
    authScheme: isAiStudio ? "Api-Key" : "Bearer",
    project: isAiStudio ? folderId : undefined,
    structuredMode: (env.LLM_STRUCTURED_MODE as StructuredMode | undefined) || "json_schema",
    // AI Studio: рассуждения выключены (по эвалу дешевле и не хуже); другой endpoint может не знать параметр
    reasoningEffort: isAiStudio ? "none" : null,
  });
}
