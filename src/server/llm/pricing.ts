import type { LlmUsage } from "./types";

/**
 * Цены AI Studio, ₽ с НДС за 1000 токенов, синхронный режим
 * (https://aistudio.yandex.ru/docs/ru/ai-studio/pricing, сверено 2026-11-24).
 * Нужны только для оценки стоимости поиска в логах; биллинг считает сам Yandex Cloud.
 */
export const LLM_PRICES_RUB_PER_1K: Record<string, { input: number; output: number }> = {
  "aliceai-llm": { input: 0.5, output: 1.2 },
  "aliceai-llm-flash": { input: 0.1, output: 0.2 },
  "deepseek-v4.1-flash": { input: 0.3, output: 0.5 },
  "qwen3.6-35b-a3b": { input: 0.2, output: 0.3 },
  "yandexgpt-5.1": { input: 0.8, output: 0.8 },
};

/** Синхронный запрос Yandex Search API, ₽ с НДС (https://aistudio.yandex.ru/docs/ru/search-api/pricing). */
export const SEARCH_REQUEST_PRICE_RUB = 0.49;

/** «gpt://folder/qwen3.6-35b-a3b/latest» → «qwen3.6-35b-a3b». */
export function modelShortName(model: string): string {
  const m = model.match(/^gpt:\/\/[^/]+\/([^/]+)/);
  return m ? m[1] : model;
}

/** Примерная стоимость в рублях; null — цена модели неизвестна. */
export function llmCostRub(model: string, usage: LlmUsage): number | null {
  const p = LLM_PRICES_RUB_PER_1K[modelShortName(model)];
  if (!p) return null;
  return (usage.inputTokens / 1000) * p.input + (usage.outputTokens / 1000) * p.output;
}
