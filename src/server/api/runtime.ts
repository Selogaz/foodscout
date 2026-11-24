import { createLlmProviderFromEnv } from "../llm";
import { createSearchProviderFromEnv } from "../search";
import { readApiConfig } from "./config";
import { createApiState, type ApiState, type SearchContext } from "./search-service";

const g = globalThis as unknown as { __fscApiState?: ApiState };

/** Контекст запроса из окружения. Состояние (кеш, лимиты) общее на процесс и переживает HMR в dev. */
export function createRuntimeContext(signal?: AbortSignal): SearchContext {
  const config = readApiConfig();
  g.__fscApiState ??= createApiState(config);
  return {
    config,
    state: g.__fscApiState,
    llm: createLlmProviderFromEnv(),
    search: createSearchProviderFromEnv(),
    signal,
  };
}
