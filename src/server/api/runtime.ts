import { createLlmProviderFromEnv } from "../llm";
import type { SearchProvider } from "../search";
import { createSearchProviderFromEnv } from "../search";
import { readApiConfig } from "./config";
import { createApiState, type ApiState, type SearchContext } from "./search-service";

const g = globalThis as unknown as {
  __fscApiState?: ApiState;
  __fscSearch?: { key: string; provider: SearchProvider | null };
};

/**
 * Провайдер поиска один на процесс: у него своя очередь «1 запрос/с», и разные запросы
 * должны стоять в ней вместе, иначе одновременные поиски ловят 429. Создаётся лениво;
 * ключ кеша — значения ключей из окружения, поэтому смена env даёт новый провайдер.
 */
export function getSearchProvider(env: Record<string, string | undefined> = process.env): SearchProvider | null {
  const key = `${env.YANDEX_API_KEY?.trim() ?? ""}\u0000${env.YANDEX_FOLDER_ID?.trim() ?? ""}`;
  if (g.__fscSearch?.key !== key) g.__fscSearch = { key, provider: createSearchProviderFromEnv(env) };
  return g.__fscSearch.provider;
}

/** Сброс общего провайдера поиска (для тестов). */
export function resetSearchProvider(): void {
  g.__fscSearch = undefined;
}

/** Контекст запроса из окружения. Состояние (кеш, лимиты) общее на процесс и переживает HMR в dev. */
export function createRuntimeContext(signal?: AbortSignal): SearchContext {
  const config = readApiConfig();
  g.__fscApiState ??= createApiState(config);
  return {
    config,
    state: g.__fscApiState,
    llm: createLlmProviderFromEnv(),
    search: getSearchProvider(),
    signal,
  };
}
