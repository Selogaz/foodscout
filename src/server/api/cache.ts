import type { SearchQuery } from "@/domain";

/** In-memory LRU с TTL. Живёт в памяти инстанса: на Vercel кеш не общий между инстансами. */
export class TtlLruCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // обновляем «свежесть» для LRU: последний вставленный — самый свежий
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

/** Ключ кеша: запрос после валидации, с нормализованным текстом и упорядоченными списками. */
export function cacheKey(q: SearchQuery): string {
  return JSON.stringify({
    c: q.category.kind === "catalog" ? ["c", q.category.categoryId, q.category.subcategoryId ?? ""] : ["f", norm(q.category.text)],
    p: norm(q.product),
    l: [q.location.regionId, q.location.cityId ?? ""],
    cert: [...q.needCertificates].sort(),
    moq: q.maxMinOrder ? [q.maxMinOrder.value, norm(q.maxMinOrder.unit)] : null,
    d: q.needDelivery,
    pi: q.priceImportance,
  });
}
