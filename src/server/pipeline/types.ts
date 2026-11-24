import type { Location, SearchQuery, SearchQueryInput, Supplier } from "@/domain";
import type { LlmProvider, LlmUsage } from "../llm/types";
import type { SearchProvider } from "../search/types";

/** Вход пайплайна: как SearchQuery, но место можно передать свободным текстом («Подольск», «мск»). */
export type SearchInput = Omit<SearchQueryInput, "location"> & { location: Location | string };

export type NormalizedQuery = {
  /** Провалидированный доменный запрос: место — регион/город справочника. */
  query: SearchQuery;
  /** Код региона для поиска (город → регион → столица региона); null — без фильтра. */
  lr: number | null;
  /** Место для поисковых фраз («Казань»). */
  placeLabel: string;
  /** Главная формулировка товара («сыр для пиццы»). */
  productPhrase: string;
  /** Категории справочника для карточек (если модель не определила категорию со страницы). */
  categoryIds: string[];
  /** Готовые поисковые фразы. */
  searchPhrases: string[];
  /** Пояснения, как понят запрос (показываются пользователю). */
  notes: string[];
};

export type Candidate = {
  /** Домен без www — ключ дедупа на этапе поиска. */
  domain: string;
  /** Лучшая найденная страница сайта. */
  url: string;
  title: string;
  snippet: string;
  /** Сколько поисковых фраз нашли этот домен (сигнал релевантности). */
  hits: number;
  score: number;
};

export type FetchedPage = {
  url: string;
  title: string;
  /** Видимый текст страницы (уже обрезанный по лимиту). */
  text: string;
  /** Какую роль играет страница: главная/найденная, контакты, доставка… */
  kind: "landing" | "home" | "contacts" | "delivery" | "about" | "price" | "docs";
};

/** Поле, которое пайплайн отбросил: значение было, но источник его не подтвердил. */
export type DroppedField = { domain: string; path: string; value: string; reason: string };

export type CandidateOutcome =
  | { status: "supplier"; domain: string; supplier: Supplier; dropped: DroppedField[] }
  | { status: "rejected"; domain: string; reason: string; dropped: DroppedField[] }
  | { status: "failed"; domain: string; error: string };

export type ProgressEvent =
  | { type: "stage"; stage: "normalize" | "search" | "fetch" | "extract" | "dedupe" | "validate"; message: string }
  | { type: "normalized"; phrases: string[]; lr: number | null; place: string; notes: string[] }
  | { type: "candidates"; count: number; candidates: { domain: string; url: string; title: string }[] }
  | { type: "candidate-start"; domain: string; index: number; total: number }
  | { type: "candidate-done"; domain: string; supplierId: string; name: string; filledFields: number }
  | { type: "candidate-skipped"; domain: string; reason: string }
  | { type: "candidate-failed"; domain: string; error: string }
  | { type: "warning"; message: string }
  | { type: "done"; suppliers: number; durationMs: number };

export type PipelineLimits = {
  /** Сколько поисковых фраз отправлять. */
  maxPhrases: number;
  /** Сколько кандидатов обрабатывать. */
  maxCandidates: number;
  /** Сколько страниц сайта загружать на кандидата. */
  maxPagesPerCandidate: number;
  /** Таймаут загрузки одной страницы. */
  pageTimeoutMs: number;
  /** Лимит размера HTML. */
  maxPageBytes: number;
  /** Сколько символов текста всех страниц отдавать модели на кандидата. */
  maxCharsPerCandidate: number;
  /** Общий бюджет времени на одного кандидата (загрузка + извлечение). */
  candidateTimeoutMs: number;
  /** Сколько кандидатов обрабатывать параллельно. */
  concurrency: number;
};

export const DEFAULT_LIMITS: PipelineLimits = {
  maxPhrases: 3,
  maxCandidates: 6,
  maxPagesPerCandidate: 4,
  pageTimeoutMs: 8_000,
  maxPageBytes: 1_500_000,
  maxCharsPerCandidate: 14_000,
  candidateTimeoutMs: 60_000,
  concurrency: 3,
};

export type PipelineDeps = {
  llm: LlmProvider;
  search: SearchProvider;
  /** Загрузка страниц (в тестах — фейк). */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  limits?: Partial<PipelineLimits>;
};

export type RunStats = {
  searchRequests: number;
  candidates: number;
  pagesFetched: number;
  suppliers: number;
  rejected: number;
  failed: number;
  droppedFields: number;
  durationMs: number;
  llmUsage: LlmUsage;
  llmCalls: number;
  /** Оценка стоимости, ₽ (поиск + токены); null — цена модели неизвестна. */
  costRub: number | null;
};

export type SearchRunResult = {
  normalized: NormalizedQuery;
  suppliers: Supplier[];
  outcomes: CandidateOutcome[];
  duplicates: { kept: string; removed: string; by: "domain" | "phone" | "email" }[];
  invalid: { id: string; issues: string }[];
  stats: RunStats;
  warnings: string[];
};

/** Ошибка входа пользователя (непонятное место и т.п.) — показывается как есть. */
export class PipelineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineInputError";
  }
}
