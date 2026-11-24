import type { RankedSupplier, SearchQuery } from "@/domain";

/** События потока /api/search: одна строка NDJSON = один объект. Только типы — модуль безопасен для клиента. */

export type StageId = "queued" | "normalize" | "search" | "fetch" | "dedupe" | "validate" | "cache" | "demo";

export type StageEvent = {
  type: "stage";
  stage: StageId;
  message: string;
  /** Общий прогресс 0..1 (приблизительный). */
  progress: number;
  /** Как понят запрос: поисковые фразы, место, пояснения. Приходит на шаге normalize. */
  detail?: { phrases: string[]; place: string; notes: string[] };
};

/** Частичный результат: сайт найден, проверяется, превратился в карточку, пропущен или упал. */
export type CandidateEvent = {
  type: "candidate";
  status: "found" | "checking" | "done" | "skipped" | "failed";
  domain: string;
  title?: string;
  url?: string;
  /** Для done: название поставщика и число заполненных полей. */
  name?: string;
  filledFields?: number;
  /** Для skipped/failed: причина по-русски. */
  reason?: string;
  progress: number;
};

export type WarningEvent = { type: "warning"; message: string };

/** Почему вместо живого поиска показаны демо-данные. */
export type DemoReason = "demo-mode" | "no-key" | "daily-limit" | "failed" | "timeout";

export type ResultEvent = {
  type: "result";
  /** true — показаны записанные/демо-данные, а не живой поиск. */
  demo: boolean;
  demoReason?: DemoReason;
  /** Человекочитаемое пояснение для демо-режима. */
  demoMessage?: string;
  /** true — ответ взят из кеша (повтор того же запроса). */
  cached: boolean;
  query: SearchQuery;
  /** Отранжированные карточки со скорингом, лучшая первой. */
  results: RankedSupplier[];
  warnings: string[];
  stats: { durationMs: number; candidates: number; suppliers: number; costRub: number | null };
};

export type ErrorCode = "invalid_request" | "rate_limited" | "unavailable" | "failed" | "timeout" | "aborted";

export type ErrorEvent = { type: "error"; code: ErrorCode; message: string };

export type SearchEvent = StageEvent | CandidateEvent | WarningEvent | ResultEvent | ErrorEvent;
