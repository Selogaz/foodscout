import { rankSuppliers, type SearchQuery } from "@/domain";
import type { DemoReason, ErrorEvent, ResultEvent, SearchEvent } from "@/lib/searchEvents";
import { LlmError, type LlmProvider } from "../llm";
import { PipelineInputError, runSearch, type ProgressEvent } from "../pipeline";
import { SearchError, type SearchProvider } from "../search";
import { cacheKey, TtlLruCache } from "./cache";
import type { ApiConfig } from "./config";
import { isRecordedExample, pickDemoRun } from "./demo";
import { DailyCounter, RateLimiter } from "./limits";

export type CachedResult = Pick<ResultEvent, "query" | "results" | "warnings" | "stats">;

export type ApiState = {
  cache: TtlLruCache<CachedResult>;
  limiter: RateLimiter;
  daily: DailyCounter;
  /** Помощник решения: отдельное окно запросов и суточный счётчик вызовов LLM (поиск не страдает). */
  assistLimiter: RateLimiter;
  assistDaily: DailyCounter;
};

export function createApiState(config: ApiConfig): ApiState {
  return {
    cache: new TtlLruCache(config.cacheMaxEntries, config.cacheTtlMs),
    limiter: new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs),
    daily: new DailyCounter(config.liveDailyLimit),
    assistLimiter: new RateLimiter(config.assistRateLimitMax, config.rateLimitWindowMs),
    assistDaily: new DailyCounter(config.assistDailyLlmLimit),
  };
}

export type SearchContext = {
  config: ApiConfig;
  state: ApiState;
  /** null — ключа нет, живой поиск недоступен. */
  llm: LlmProvider | null;
  search: SearchProvider | null;
  fetchImpl?: typeof fetch;
  /** Клиент отключился — прекращаем работу. */
  signal?: AbortSignal;
};

const DEMO_MESSAGES: Record<DemoReason, string> = {
  "demo-mode": "Показаны демонстрационные данные: живой поиск на этом стенде отключён.",
  example: "Это записанный пример: он показан сразу, без живого поиска. Чтобы запустить живой поиск, введите свой запрос.",
  "no-key": "Ключ поиска не настроен, поэтому показаны демонстрационные данные.",
  "daily-limit": "Суточный лимит живых поисков исчерпан, поэтому показаны демонстрационные данные.",
  failed: "Живой поиск не удался, поэтому показаны демонстрационные данные.",
  timeout: "Живой поиск не уложился во время, поэтому показаны демонстрационные данные.",
};

class LiveTimeout extends Error {}

/** Описание сбоя живого поиска для пользователя (без технических деталей и ключей). */
function describeFailure(e: unknown): { code: ErrorEvent["code"]; message: string } {
  if (e instanceof LiveTimeout) return { code: "timeout", message: "Поиск не уложился во время. Попробуйте ещё раз или сузьте запрос." };
  if (e instanceof LlmError && (e.kind === "auth" || e.kind === "billing")) {
    return { code: "unavailable", message: "Сервис поиска временно недоступен (проблема с доступом к модели)." };
  }
  if (e instanceof SearchError && (e.kind === "auth" || e.kind === "billing")) {
    return { code: "unavailable", message: "Сервис поиска временно недоступен (проблема с доступом к поисковику)." };
  }
  return { code: "failed", message: "Не удалось выполнить поиск. Попробуйте ещё раз чуть позже." };
}

/**
 * Выполняет поиск и отдаёт события в emit. Порядок: режим on → демо; auto и точный пример → запись; кеш; нет ключа / суточный лимит;
 * живой пайплайн с таймаутом. Сбой живого поиска в режиме auto → демо с флагом, в off → событие error.
 * Исключений наружу не бросает: всё заканчивается событием result или error.
 */
export async function executeSearch(query: SearchQuery, emit: (e: SearchEvent) => void, ctx: SearchContext): Promise<void> {
  const { config, state } = ctx;
  const started = Date.now();

  const sendDemo = (reason: DemoReason) => {
    emit({ type: "stage", stage: "demo", message: DEMO_MESSAGES[reason], progress: 0.5 });
    const demo = pickDemoRun(query);
    emit({
      type: "result",
      demo: true,
      demoReason: reason,
      demoMessage: DEMO_MESSAGES[reason],
      demoInfo: demo.info,
      cached: false,
      query: demo.query,
      results: demo.results,
      warnings: demo.warnings,
      stats: { durationMs: Date.now() - started, candidates: demo.stats.candidates, suppliers: demo.results.length, costRub: 0 },
    });
  };
  /** В режиме auto — демо, в off — честная ошибка. */
  const fallback = (reason: DemoReason, err: { code: ErrorEvent["code"]; message: string }) => {
    if (config.demoMode === "off") emit({ type: "error", ...err });
    else sendDemo(reason);
  };

  if (config.demoMode === "on") return sendDemo("demo-mode");
  // auto: запрос, точно совпавший с записанным примером, отдаём из записи мгновенно и бесплатно;
  // живой поиск — только для собственных запросов пользователя. В режиме off — всегда живой.
  if (config.demoMode === "auto" && isRecordedExample(query)) return sendDemo("example");

  const key = cacheKey(query);
  const hit = state.cache.get(key);
  if (hit) {
    emit({ type: "stage", stage: "cache", message: "Результат найден в кеше", progress: 0.9 });
    emit({ type: "result", demo: false, cached: true, ...hit });
    return;
  }

  if (!ctx.llm || !ctx.search) {
    return fallback("no-key", { code: "unavailable", message: "Живой поиск не настроен: нет ключа Yandex Cloud." });
  }
  if (!state.daily.tryTake()) {
    return fallback("daily-limit", { code: "rate_limited", message: "Суточный лимит живых поисков исчерпан. Попробуйте завтра." });
  }

  emit({ type: "stage", stage: "queued", message: "Запускаем поиск", progress: 0.02 });

  let doneCandidates = 0;
  let totalCandidates = 0;
  const onProgress = (e: ProgressEvent) => {
    switch (e.type) {
      case "stage": {
        const progress = { normalize: 0.05, search: 0.15, fetch: 0.3, extract: 0.3, dedupe: 0.9, validate: 0.95 }[e.stage];
        return emit({ type: "stage", stage: e.stage === "extract" ? "fetch" : e.stage, message: e.message, progress });
      }
      case "normalized":
        return emit({
          type: "stage",
          stage: "normalize",
          message: `Запрос понят: ${e.place}`,
          progress: 0.1,
          detail: { phrases: e.phrases, place: e.place, notes: e.notes },
        });
      case "candidates": {
        totalCandidates = e.count;
        for (const c of e.candidates) emit({ type: "candidate", status: "found", domain: c.domain, url: c.url, title: c.title, progress: 0.28 });
        return;
      }
      case "candidate-start":
        return emit({ type: "candidate", status: "checking", domain: e.domain, progress: 0.3 + 0.55 * (doneCandidates / Math.max(1, totalCandidates)) });
      case "candidate-done":
      case "candidate-skipped":
      case "candidate-failed": {
        doneCandidates++;
        const progress = 0.3 + 0.55 * (doneCandidates / Math.max(1, totalCandidates));
        if (e.type === "candidate-done") return emit({ type: "candidate", status: "done", domain: e.domain, name: e.name, filledFields: e.filledFields, progress });
        if (e.type === "candidate-skipped") return emit({ type: "candidate", status: "skipped", domain: e.domain, reason: e.reason, progress });
        return emit({ type: "candidate", status: "failed", domain: e.domain, reason: e.error, progress });
      }
      case "warning":
        return emit({ type: "warning", message: e.message });
      case "done":
        return;
    }
  };

  const timeoutSignal = AbortSignal.timeout(config.liveTimeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeoutSignal]) : timeoutSignal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // страховка: если какой-то шаг проигнорирует сигнал, всё равно прекращаем ожидание
    const hardTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LiveTimeout()), config.liveTimeoutMs + 2_000);
      ctx.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const run = await Promise.race([
      runSearch(
        query,
        onProgress,
        { llm: ctx.llm, search: ctx.search, fetchImpl: ctx.fetchImpl },
        { signal },
      ),
      hardTimeout,
    ]);
    const results = rankSuppliers(run.suppliers, run.normalized.query);
    const payload: CachedResult = {
      query: run.normalized.query,
      results,
      warnings: run.warnings,
      stats: { durationMs: run.stats.durationMs, candidates: run.stats.candidates, suppliers: run.stats.suppliers, costRub: run.stats.costRub },
    };
    // пустую выдачу не кешируем: она может быть следствием временного сбоя
    if (results.length > 0) state.cache.set(key, payload);
    emit({ type: "result", demo: false, cached: false, ...payload });
  } catch (e) {
    if (ctx.signal?.aborted) return emit({ type: "error", code: "aborted", message: "Поиск отменён" });
    if (e instanceof PipelineInputError) return emit({ type: "error", code: "invalid_request", message: e.message });
    console.error("Ошибка живого поиска", e);
    const failure = timeoutSignal.aborted && !(e instanceof LiveTimeout) ? describeFailure(new LiveTimeout()) : describeFailure(e);
    fallback(failure.code === "timeout" ? "timeout" : "failed", failure);
  } finally {
    clearTimeout(timer);
  }
}
