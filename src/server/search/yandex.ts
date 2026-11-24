import { SearchError, type SearchHit, type SearchOptions, type SearchProvider } from "./types";

export const YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";

export type YandexSearchConfig = {
  apiKey: string;
  folderId: string;
  timeoutMs?: number;
  /**
   * Пауза между запросами. Квота по умолчанию — 1 запрос в секунду на каталог
   * (search-api.webSearchRequestsPerSecond), поэтому запросы идут по очереди.
   */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

/** Разбор XML-ответа Яндекс Поиска (формат FORMAT_XML) в список результатов. */
export function parseYandexXml(xml: string): SearchHit[] {
  const err = xml.match(/<error code="(\d+)"[^>]*>([\s\S]*?)<\/error>/);
  if (err) {
    // 15 — «ничего не найдено», это не ошибка
    if (err[1] === "15") return [];
    throw new SearchError(`Ошибка Яндекс Поиска ${err[1]}: ${decodeXml(err[2])}`, "bad-response");
  }
  const hits: SearchHit[] = [];
  for (const m of xml.matchAll(/<doc\b[^>]*>([\s\S]*?)<\/doc>/g)) {
    const doc = m[1];
    const url = tag(doc, "url");
    if (!url) continue;
    const passages = [...doc.matchAll(/<passage>([\s\S]*?)<\/passage>/g)].map((p) => decodeXml(p[1]));
    const headline = tag(doc, "headline");
    hits.push({
      url: decodeXml(url),
      title: decodeXml(tag(doc, "title") ?? ""),
      snippet: [headline ? decodeXml(headline) : "", ...passages].filter(Boolean).join(" … "),
    });
  }
  return hits;
}

/** Адаптер Yandex Search API v2 (синхронный веб-поиск, POST /v2/web/search). */
export class YandexSearchProvider implements SearchProvider {
  readonly name = "yandex";
  /** Очередь запросов: квота общая на каталог, параллельные вызовы ловят 429. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;
  constructor(private readonly cfg: YandexSearchConfig) {}

  search(query: string, regionLr: number | null, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const run = this.queue.then(async () => {
      const gap = (this.cfg.minIntervalMs ?? 1100) - (Date.now() - this.lastAt);
      if (gap > 0) await sleep(gap);
      try {
        return await this.request(query, regionLr, opts);
      } catch (e) {
        // Один повтор после паузы, если всё же упёрлись в квоту
        if (e instanceof SearchError && e.kind === "rate-limit") {
          await sleep(this.cfg.minIntervalMs ?? 1100);
          return await this.request(query, regionLr, opts);
        }
        throw e;
      } finally {
        this.lastAt = Date.now();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async request(query: string, regionLr: number | null, opts: SearchOptions): Promise<SearchHit[]> {
    const timeoutMs = this.cfg.timeoutMs ?? 15_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const body = {
      query: { searchType: "SEARCH_TYPE_RU", queryText: query.slice(0, 400), familyMode: "FAMILY_MODE_MODERATE" },
      // Один документ на домен: нам нужны разные компании, а не страницы одного сайта
      groupSpec: { groupMode: "GROUP_MODE_DEEP", groupsOnPage: String(opts.limit ?? 10), docsInGroup: "1" },
      maxPassages: "2",
      ...(regionLr != null ? { region: String(regionLr) } : {}),
      l10n: "LOCALIZATION_RU",
      folderId: this.cfg.folderId,
      responseFormat: "FORMAT_XML",
    };
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(YANDEX_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Api-Key ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new SearchError(`Яндекс Поиск не ответил за ${timeoutMs} мс`, "timeout");
      }
      throw new SearchError(`Сетевая ошибка поиска: ${(e as Error).message}`, "network");
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 500);
      const kind =
        res.status === 401 || res.status === 403 ? "auth"
        : res.status === 402 ? "billing"
        : res.status === 429 ? "rate-limit"
        : "http";
      throw new SearchError(`Яндекс Поиск HTTP ${res.status}: ${text}`, kind, res.status);
    }
    const json = (await res.json()) as { rawData?: string };
    if (!json.rawData) throw new SearchError("В ответе поиска нет rawData", "bad-response");
    // rawData — bytes в JSON, т.е. base64
    const xml = Buffer.from(json.rawData, "base64").toString("utf8");
    return parseYandexXml(xml);
  }
}
