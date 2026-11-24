import { existsSync } from "node:fs";

/** Подхватывает .env.local (если есть) — ключи не печатаются. */
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export const hasYandexKey = () => Boolean(process.env.YANDEX_API_KEY?.trim() && process.env.YANDEX_FOLDER_ID?.trim());
