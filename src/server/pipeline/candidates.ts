import type { SearchHit, SearchProvider } from "../search/types";
import type { Candidate, NormalizedQuery } from "./types";

/**
 * Домены, которые не являются сайтами поставщиков: маркетплейсы, агрегаторы и справочники
 * компаний, соцсети, СМИ. Их карточки — чужие данные о поставщике, и у них нет контактов
 * самого поставщика, поэтому в кандидаты они не идут.
 */
export const BLOCKED_DOMAINS = [
  // маркетплейсы и доски объявлений
  "avito.ru", "ozon.ru", "wildberries.ru", "wb.ru", "market.yandex.ru", "megamarket.ru", "sbermegamarket.ru",
  "aliexpress.ru", "aliexpress.com", "alibaba.com", "1688.com", "kazanexpress.ru", "lamoda.ru", "youla.ru",
  "vseinstrumenti.ru", "leroymerlin.ru", "petrovich.ru",
  // розничные сети и доставка продуктов: цены и условия для частных покупателей, не B2B
  "perekrestok.ru", "auchan.ru", "magnit.ru", "lenta.com", "dixy.ru", "okmarket.ru", "vprok.ru", "5ka.ru",
  "samokat.ru", "utkonos.ru", "sbermarket.ru", "kuper.ru", "vkusvill.ru",
  // B2B-агрегаторы и каталоги компаний
  "tiu.ru", "pulscen.ru", "satom.ru", "flagma.ru", "flagma-rus.ru", "all.biz", "deal.by", "optlist.ru",
  "b2b-center.ru", "b2b.ru", "regmarkets.ru", "cataloxy.ru", "fabricators.ru", "russiafood.ru", "agroserver.ru",
  "rosfirm.ru", "spravker.ru", "orgpage.ru", "yp.ru", "yell.ru", "zoon.ru", "2gis.ru", "2gis.com", "flamp.ru",
  "rusprofile.ru", "list-org.com", "sbis.ru", "checko.ru", "zachestnyibiznes.ru", "companies.rbc.ru", "kontur.ru",
  "spark-interfax.ru", "export-base.ru", "proizvoditeli-rossii.ru",
  "made-in-russia.ru", "unipack.ru", "upakovano.ru",
  "rosupack.ru", "kompass.com", "europages.com",
  "tenderguru.ru", "zakupki.gov.ru", "productcenter.ru", "regtorg.ru",
  // поисковики, соцсети, видео, СМИ, справочное
  "yandex.ru", "ya.ru", "dzen.ru", "google.com", "vk.com", "vk.ru", "ok.ru", "t.me", "telegram.me", "youtube.com",
  "rutube.ru", "pinterest.com", "instagram.com", "facebook.com", "wikipedia.org", "hh.ru", "superjob.ru",
  "rbc.ru", "kommersant.ru", "vc.ru", "habr.com", "pikabu.ru", "otzovik.com", "irecommend.ru", "tripadvisor.ru",
];

/** Заголовки подборок и каталогов компаний («Топ-10 поставщиков…», «Каталог производителей»). */
const AGGREGATOR_TITLE =
  /(топ[-\s]?\d+|\b\d{2,}\s+(компани|поставщик|производител|фирм)|список\s+(компаний|поставщиков|производителей)|каталог\s+(компаний|поставщиков|производителей|фирм)|рейтинг\s+(компаний|поставщиков|производителей)|все\s+(поставщики|производители|компании)|справочник\s+(компаний|предприятий))/i;

export function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^(www\d?|m)\./, "");
  } catch {
    return null;
  }
}

export function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`));
}

/** Почему результат поиска не подходит в кандидаты (null — подходит). */
export function rejectHitReason(hit: SearchHit): string | null {
  const domain = domainOf(hit.url);
  if (!domain) return "некорректный URL";
  if (!/^https?:/i.test(hit.url)) return "не веб-страница";
  if (/\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i.test(hit.url)) return "файл, а не страница";
  if (isBlockedDomain(domain)) return "маркетплейс, агрегатор или справочник";
  if (AGGREGATOR_TITLE.test(hit.title)) return "подборка или каталог компаний";
  return null;
}

/**
 * Поиск кандидатов: каждая формулировка отдельным запросом с lr, объединение по домену,
 * фильтр мусора и ранжирование: домен, найденный несколькими фразами и выше в выдаче, — первым.
 */
export async function findCandidates(
  nq: NormalizedQuery,
  search: SearchProvider,
  opts: { limit: number; perQuery?: number; signal?: AbortSignal },
): Promise<{ candidates: Candidate[]; requests: number; filtered: { url: string; reason: string }[]; errors: string[] }> {
  const results = await Promise.allSettled(
    nq.searchPhrases.map((q) => search.search(q, nq.lr, { limit: opts.perQuery ?? 10, signal: opts.signal })),
  );
  const errors: string[] = [];
  const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
  results.forEach((r, i) => {
    if (r.status === "rejected") errors.push(`«${nq.searchPhrases[i]}»: ${(r.reason as Error).message}`);
  });
  if (errors.length === results.length && firstError) throw firstError;

  const byDomain = new Map<string, Candidate>();
  const filtered: { url: string; reason: string }[] = [];
  results.forEach((r) => {
    if (r.status !== "fulfilled") return;
    r.value.forEach((hit, rank) => {
      const reason = rejectHitReason(hit);
      if (reason) {
        filtered.push({ url: hit.url, reason });
        return;
      }
      const domain = domainOf(hit.url)!;
      const gain = 1 / (rank + 1);
      const prev = byDomain.get(domain);
      if (prev) {
        prev.hits += 1;
        prev.score += gain;
      } else {
        byDomain.set(domain, { domain, url: hit.url, title: hit.title, snippet: hit.snippet, hits: 1, score: gain });
      }
    });
  });
  const candidates = [...byDomain.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit);
  return { candidates, requests: results.length, filtered, errors };
}
