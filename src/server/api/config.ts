export type DemoMode = "auto" | "on" | "off";

export type ApiConfig = {
  /** on — только демо; off — только живой поиск (без фолбэка); auto — живой, при сбое демо. */
  demoMode: DemoMode;
  /** Живых поисков в сутки на инстанс (предохранитель бюджета). */
  liveDailyLimit: number;
  /** Запросов в окно с одного IP. */
  rateLimitMax: number;
  rateLimitWindowMs: number;
  /** Жёсткий таймаут живого поиска (живой прогон ≈32–37 с). */
  liveTimeoutMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
};

type Env = Record<string, string | undefined>;

function int(v: string | undefined, def: number, min = 0): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

/**
 * Читает настройки из окружения. DEMO_MODE не задан или неверен: в продакшене `on`
 * (живой поиск включается явно, DEMO_MODE=auto), в разработке `auto`.
 */
export function readApiConfig(env: Env = process.env): ApiConfig {
  const raw = env.DEMO_MODE?.trim().toLowerCase();
  const demoMode: DemoMode =
    raw === "auto" || raw === "on" || raw === "off" ? raw : env.NODE_ENV === "production" ? "on" : "auto";
  return {
    demoMode,
    liveDailyLimit: int(env.LIVE_SEARCH_DAILY_LIMIT, 5),
    rateLimitMax: int(env.RATE_LIMIT_PER_MINUTE, 5, 1),
    rateLimitWindowMs: 60_000,
    liveTimeoutMs: int(env.LIVE_SEARCH_TIMEOUT_S, 100, 5) * 1000,
    cacheTtlMs: int(env.SEARCH_CACHE_TTL_MIN, 360, 1) * 60_000,
    cacheMaxEntries: 50,
  };
}
