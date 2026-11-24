/** Скользящее окно: не более `max` запросов с ключа (IP) за `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Регистрирует запрос. ok=false — лимит исчерпан, retryAfterS — через сколько секунд можно снова. */
  take(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((recent[0] + this.windowMs - t) / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) {
      for (const [k, v] of this.hits) if (v.every((x) => x <= t - this.windowMs)) this.hits.delete(k);
    }
    return { ok: true };
  }
}

/** Счётчик живых поисков за календарные сутки (UTC) — предохранитель бюджета. */
export class DailyCounter {
  private day = "";
  private n = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private roll() {
    const d = this.now().toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.n = 0;
    }
  }

  /** Занимает одну попытку; false — суточный лимит исчерпан. */
  tryTake(): boolean {
    this.roll();
    if (this.n >= this.limit) return false;
    this.n++;
    return true;
  }

  get used(): number {
    this.roll();
    return this.n;
  }
}
