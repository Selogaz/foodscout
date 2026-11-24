import { llmCostRub, SEARCH_REQUEST_PRICE_RUB } from "../llm/pricing";
import { LlmError } from "../llm/types";
import { findCandidates } from "./candidates";
import { dedupeSuppliers, validateSuppliers } from "./dedupe";
import { extractSupplier, filledCount } from "./extract";
import { fetchPages } from "./fetch-pages";
import { MeteredLlm } from "./metered-llm";
import { normalizeQuery } from "./normalize";
import {
  type Candidate,
  type CandidateOutcome,
  DEFAULT_LIMITS,
  type PipelineDeps,
  type ProgressEvent,
  type SearchInput,
  type SearchRunResult,
} from "./types";

/** Ошибки, при которых продолжать бессмысленно: все следующие вызовы упадут так же. */
const isFatal = (e: unknown) => e instanceof LlmError && (e.kind === "auth" || e.kind === "billing");

/** Параллельная обработка с ограничением числа одновременных задач, порядок результатов сохраняется. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Оркестратор поиска: нормализация → кандидаты → загрузка страниц → извлечение → дедуп → валидация.
 * Сбой одного кандидата (таймаут, битый сайт, невалидный ответ модели) не роняет поиск:
 * он попадает в outcomes как failed, остальные обрабатываются.
 */
export async function runSearch(
  input: SearchInput,
  onProgress: (e: ProgressEvent) => void,
  deps: PipelineDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchRunResult> {
  const started = Date.now();
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const llm = new MeteredLlm(deps.llm);
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];
  const emit = (e: ProgressEvent) => {
    try {
      onProgress(e);
    } catch {
      /* ошибка подписчика не должна ломать поиск */
    }
  };

  emit({ type: "stage", stage: "normalize", message: "Разбираем запрос" });
  const nq = await normalizeQuery(input, llm, { maxPhrases: limits.maxPhrases, signal: opts.signal });
  emit({ type: "normalized", phrases: nq.searchPhrases, lr: nq.lr, place: nq.placeLabel, notes: nq.notes });

  emit({ type: "stage", stage: "search", message: `Ищем поставщиков: ${nq.searchPhrases.length} запроса в Яндексе` });
  const found = await findCandidates(nq, deps.search, { limit: limits.maxCandidates, signal: opts.signal });
  for (const err of found.errors) {
    warnings.push(`Поиск по фразе не удался: ${err}`);
    emit({ type: "warning", message: `Поиск по одной из фраз не удался` });
  }
  emit({
    type: "candidates",
    count: found.candidates.length,
    candidates: found.candidates.map((c) => ({ domain: c.domain, url: c.url, title: c.title })),
  });

  let pagesFetched = 0;
  let fatal: unknown = null;
  emit({ type: "stage", stage: "fetch", message: `Изучаем сайты: ${found.candidates.length}` });
  const outcomes = await mapLimit(found.candidates, limits.concurrency, async (c: Candidate, i): Promise<CandidateOutcome> => {
    if (fatal) return { status: "failed", domain: c.domain, error: "поиск остановлен из-за ошибки доступа к модели" };
    emit({ type: "candidate-start", domain: c.domain, index: i + 1, total: found.candidates.length });
    const budget = AbortSignal.timeout(limits.candidateTimeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
    try {
      const { pages } = await fetchPages(c, limits, { fetchImpl: deps.fetchImpl, signal });
      pagesFetched += pages.length;
      const outcome = await extractSupplier(c, pages, nq, llm, { collectedAt: now().toISOString(), signal });
      if (outcome.status === "supplier") {
        emit({ type: "candidate-done", domain: c.domain, supplierId: outcome.supplier.id, name: outcome.supplier.name, filledFields: filledCount(outcome.supplier) });
      } else {
        emit({ type: "candidate-skipped", domain: c.domain, reason: outcome.reason });
      }
      return outcome;
    } catch (e) {
      if (isFatal(e)) fatal = e;
      const error = signal.aborted && !opts.signal?.aborted ? `не уложился в ${limits.candidateTimeoutMs / 1000} с` : (e as Error).message;
      emit({ type: "candidate-failed", domain: c.domain, error });
      return { status: "failed", domain: c.domain, error };
    }
  });
  if (fatal) throw fatal;

  emit({ type: "stage", stage: "dedupe", message: "Убираем дубли" });
  const extracted = outcomes.flatMap((o) => (o.status === "supplier" ? [o.supplier] : []));
  const { suppliers: unique, duplicates } = dedupeSuppliers(extracted);

  emit({ type: "stage", stage: "validate", message: "Проверяем карточки" });
  const { valid, invalid } = validateSuppliers(unique);
  for (const x of invalid) warnings.push(`Карточка ${x.id} не прошла проверку: ${x.issues}`);

  const llmCost = llmCostRub(llm.model, llm.usage);
  const durationMs = Date.now() - started;
  emit({ type: "done", suppliers: valid.length, durationMs });
  return {
    normalized: nq,
    suppliers: valid,
    outcomes,
    duplicates,
    invalid,
    warnings,
    stats: {
      searchRequests: found.requests,
      candidates: found.candidates.length,
      pagesFetched,
      suppliers: valid.length,
      rejected: outcomes.filter((o) => o.status === "rejected").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      droppedFields: outcomes.reduce((n, o) => n + ("dropped" in o ? o.dropped.length : 0), 0),
      durationMs,
      llmUsage: llm.usage,
      llmCalls: llm.calls,
      costRub: llmCost === null ? null : llmCost + found.requests * SEARCH_REQUEST_PRICE_RUB,
    },
  };
}
