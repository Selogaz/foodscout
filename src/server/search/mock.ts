import type { SearchHit, SearchOptions, SearchProvider } from "./types";

/** Поиск на фикстурах: ответ выбирается функцией по тексту запроса и коду региона. */
export class MockSearchProvider implements SearchProvider {
  readonly name = "mock";
  readonly calls: { query: string; regionLr: number | null }[] = [];

  constructor(private readonly respond: (query: string, regionLr: number | null) => SearchHit[] | Promise<SearchHit[]>) {}

  async search(query: string, regionLr: number | null, opts: SearchOptions = {}): Promise<SearchHit[]> {
    this.calls.push({ query, regionLr });
    const hits = await this.respond(query, regionLr);
    return opts.limit ? hits.slice(0, opts.limit) : hits;
  }
}
