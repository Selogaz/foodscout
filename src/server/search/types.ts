/** Один результат веб-поиска. */
export type SearchHit = { title: string; url: string; snippet: string };

export type SearchOptions = { signal?: AbortSignal; limit?: number };

/** Поисковик за интерфейсом: заменить Яндекс на другой источник — это новый адаптер, а не правка пайплайна. */
export interface SearchProvider {
  readonly name: string;
  /** regionLr — код региона Яндекса (параметр lr); null — без регионального фильтра. */
  search(query: string, regionLr: number | null, opts?: SearchOptions): Promise<SearchHit[]>;
}

export type SearchErrorKind = "auth" | "billing" | "rate-limit" | "timeout" | "http" | "network" | "bad-response";

export class SearchError extends Error {
  constructor(
    message: string,
    readonly kind: SearchErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SearchError";
  }
}
