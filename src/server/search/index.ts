import type { SearchProvider } from "./types";
import { YandexSearchProvider } from "./yandex";

export * from "./types";
export { YandexSearchProvider, parseYandexXml, YANDEX_SEARCH_URL } from "./yandex";
export { MockSearchProvider } from "./mock";
export { searchLrForLocation, locationLabel } from "./region";

/** Yandex Search API из окружения (YANDEX_API_KEY, YANDEX_FOLDER_ID); null — ключа нет. */
export function createSearchProviderFromEnv(env: Record<string, string | undefined> = process.env): SearchProvider | null {
  const apiKey = env.YANDEX_API_KEY?.trim();
  const folderId = env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId) return null;
  return new YandexSearchProvider({ apiKey, folderId });
}
