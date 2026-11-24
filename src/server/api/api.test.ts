import { describe, expect, it } from "vitest";
import { DEMO_EXAMPLES } from "@/data/demo";
import { buildQuery, EMPTY_FORM } from "@/lib/formState";
import { SearchQuerySchema, type SearchQuery } from "@/domain";
import type { ResultEvent, SearchEvent } from "@/lib/searchEvents";
import { MockProvider } from "../llm/mock";
import { LlmError } from "../llm/types";
import { EXTRACTIONS, fakeFetch, NORMALIZE_ANSWER, SEARCH_HITS, SITES } from "../pipeline/__fixtures__/sites";
import { MockSearchProvider } from "../search/mock";
import { cacheKey, TtlLruCache } from "./cache";
import { readApiConfig, type ApiConfig } from "./config";
import { DailyCounter, RateLimiter } from "./limits";
import { createApiState, executeSearch, type SearchContext } from "./search-service";

const query: SearchQuery = SearchQuerySchema.parse({
  category: { kind: "free", text: "упаковка для кофе" },
  product: "крафт-пакеты с клапаном", // не совпадает с записанным примером: идёт в живой поиск
  location: { regionId: "moscow", cityId: "moscow" },
});

function chipQuery(id: string): SearchQuery {
  const ex = DEMO_EXAMPLES.find((e) => e.id === id)!;
  const r = buildQuery({ ...EMPTY_FORM, category: ex.category, product: ex.product, location: ex.location });
  if (!r.ok) throw new Error("запрос чипа не собрался");
  return r.query;
}

const baseConfig: ApiConfig = { ...readApiConfig({ DEMO_MODE: "auto" }), liveTimeoutMs: 5_000 };

function extractionFor(user: string) {
  const domain = Object.keys(EXTRACTIONS).find((d) => user.includes(`URL: https://${d}`));
  if (!domain) throw new Error("нет фикстуры для страницы");
  return EXTRACTIONS[domain];
}

function liveCtx(over: Partial<Omit<SearchContext, "config">> & { config?: Partial<ApiConfig> } = {}) {
  const llm = new MockProvider(({ schemaName, user }) => (schemaName === "normalize_query" ? NORMALIZE_ANSWER : extractionFor(user)));
  const search = new MockSearchProvider(() => SEARCH_HITS);
  const config = { ...baseConfig, ...over.config };
  const ctx: SearchContext = { state: createApiState(config), llm, search, fetchImpl: fakeFetch(SITES), ...over, config };
  return { ctx, llm, search };
}

async function run(ctx: SearchContext): Promise<SearchEvent[]> {
  const events: SearchEvent[] = [];
  await executeSearch(query, (e) => events.push(e), ctx);
  return events;
}
const last = (ev: SearchEvent[]) => ev[ev.length - 1];

describe("формат событий (живой путь на моках)", () => {
  it("stage → candidate → result со скорингом, прогресс не убывает", async () => {
    const { ctx } = liveCtx();
    const ev = await run(ctx);
    const types = new Set(ev.map((e) => e.type));
    expect(types).toEqual(new Set(["stage", "candidate", "result"]));
    expect(ev.filter((e) => e.type === "stage").map((e) => e.type === "stage" && e.stage)).toEqual(
      expect.arrayContaining(["queued", "normalize", "search", "fetch", "dedupe", "validate"]),
    );
    const progress = ev.flatMap((e) => ("progress" in e ? [e.progress] : []));
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);

    const found = ev.filter((e) => e.type === "candidate" && e.status === "found");
    expect(found.length).toBe(3);
    expect(ev.some((e) => e.type === "candidate" && e.status === "done" && e.name === "Тест Кофепак")).toBe(true);

    const r = last(ev) as ResultEvent;
    expect(r.type).toBe("result");
    expect(r.demo).toBe(false);
    expect(r.cached).toBe(false);
    expect(r.results.map((x) => x.rank)).toEqual([1, 2]);
    expect(r.results[0].score.total).toBeGreaterThanOrEqual(r.results[1].score.total);
    expect(r.results[0].score.pros.length).toBeGreaterThan(0);
    // у normalize-события есть пояснение, как понят запрос
    expect(ev.some((e) => e.type === "stage" && e.detail?.phrases.length)).toBe(true);
  });
});

describe("кеш", () => {
  it("повтор отдаётся из кеша без вызовов модели и поиска", async () => {
    const { ctx, llm, search } = liveCtx();
    await run(ctx);
    const calls = llm.calls.length;
    const sCalls = search.calls.length;
    expect(calls).toBeGreaterThan(0);
    const again = await run(ctx);
    expect(llm.calls.length).toBe(calls);
    expect(search.calls.length).toBe(sCalls);
    const r = last(again) as ResultEvent;
    expect(r.cached).toBe(true);
    expect(r.demo).toBe(false);
    expect(r.results.length).toBe(2);
    expect(ctx.state.daily.used).toBe(1);
  });

  it("ключ нормализует регистр, ё, пробелы и порядок сертификатов", () => {
    const a = SearchQuerySchema.parse({ ...query, category: { kind: "free", text: "  Мёд  ПЧЕЛИНЫЙ " }, needCertificates: ["haccp", "gost"] });
    const b = SearchQuerySchema.parse({ ...query, category: { kind: "free", text: "мед пчелиный" }, needCertificates: ["gost", "haccp"] });
    expect(cacheKey(a)).toBe(cacheKey(b));
    expect(cacheKey(a)).not.toBe(cacheKey(query));
  });

  it("LRU вытесняет давно не использованное, TTL истекает", () => {
    let t = 0;
    const c = new TtlLruCache<number>(2, 100, () => t);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    t = 101;
    expect(c.get("a")).toBeUndefined();
  });
});

describe("режимы и демо-фолбэк", () => {
  it("auto без ключа → демо с флагом demo и причиной no-key", async () => {
    const { ctx } = liveCtx({ llm: null, search: null });
    const r = last(await run(ctx)) as ResultEvent;
    expect(r.demo).toBe(true);
    expect(r.demoReason).toBe("no-key");
    expect(r.demoMessage).toMatch(/демонстрац/);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].score.total).toBeGreaterThanOrEqual(r.results[r.results.length - 1].score.total);
  });

  it("off без ключа → error, не демо", async () => {
    const { ctx } = liveCtx({ llm: null, search: null, config: { demoMode: "off" } });
    const e = last(await run(ctx));
    expect(e).toMatchObject({ type: "error", code: "unavailable" });
  });

  it("on → демо, живой пайплайн не вызывается", async () => {
    const { ctx, llm, search } = liveCtx({ config: { demoMode: "on" } });
    const r = last(await run(ctx)) as ResultEvent;
    expect(r).toMatchObject({ demo: true, demoReason: "demo-mode" });
    expect(llm.calls.length + search.calls.length).toBe(0);
  });

  it("auto: точный чип-пример отдаётся из записи, живой пайплайн не трогается", async () => {
    const { ctx, llm, search } = liveCtx();
    const ev: SearchEvent[] = [];
    await executeSearch(chipQuery("upakovka-kofe-moskva"), (e) => ev.push(e), ctx);
    const r = last(ev) as ResultEvent;
    expect(r).toMatchObject({ type: "result", demo: true, demoReason: "example", cached: false, demoInfo: { match: "exact" } });
    expect(r.demoMessage).toMatch(/записанный пример/);
    expect(r.results.length).toBeGreaterThan(0);
    expect(llm.calls.length + search.calls.length).toBe(0);
    expect(ctx.state.daily.used).toBe(0);
  });

  it("auto: собственный запрос идёт в живой поиск, а не в демо", async () => {
    const { ctx, llm } = liveCtx();
    const r = last(await run(ctx)) as ResultEvent;
    expect(r).toMatchObject({ demo: false, cached: false });
    expect(llm.calls.length).toBeGreaterThan(0);
  });

  it("off: чип-пример тоже идёт в живой поиск", async () => {
    const { ctx, llm } = liveCtx({ config: { demoMode: "off" } });
    const ev: SearchEvent[] = [];
    await executeSearch(chipQuery("upakovka-kofe-moskva"), (e) => ev.push(e), ctx);
    expect(last(ev)).toMatchObject({ type: "result", demo: false });
    expect(llm.calls.length).toBeGreaterThan(0);
  });

  it("все чипы-примеры в auto отдаются как записанные", async () => {
    const { ctx } = liveCtx({ llm: null, search: null });
    for (const e of DEMO_EXAMPLES) {
      const ev: SearchEvent[] = [];
      await executeSearch(chipQuery(e.id), (x) => ev.push(x), ctx);
      expect(last(ev), e.id).toMatchObject({ type: "result", demoReason: "example", demoInfo: { match: "exact", runId: e.id } });
    }
  });

  it("сбой пайплайна в auto → демо (failed); в off → error", async () => {
    const boom = new MockProvider(() => {
      throw new LlmError("нет доступа", "auth");
    });
    const auto = liveCtx({ llm: boom });
    expect(last(await run(auto.ctx))).toMatchObject({ type: "result", demo: true, demoReason: "failed" });
    const off = liveCtx({ llm: boom, config: { demoMode: "off" } });
    expect(last(await run(off.ctx))).toMatchObject({ type: "error", code: "unavailable" });
  });

  it("превышение времени → демо с причиной timeout", async () => {
    const slow = new MockSearchProvider(() => new Promise(() => {}));
    const { ctx } = liveCtx({ search: slow, config: { liveTimeoutMs: 50 } });
    const r = last(await run(ctx)) as ResultEvent;
    expect(r).toMatchObject({ type: "result", demo: true, demoReason: "timeout" });
  }, 10_000);

  it("суточный лимит живых поисков: сверх лимита — демо, кеш при этом работает", async () => {
    const { ctx, llm } = liveCtx({ config: { liveDailyLimit: 1 } });
    await run(ctx); // живой №1
    const q2 = SearchQuerySchema.parse({ ...query, product: "стаканчики" });
    const ev: SearchEvent[] = [];
    await executeSearch(q2, (e) => ev.push(e), ctx);
    expect(last(ev)).toMatchObject({ type: "result", demo: true, demoReason: "daily-limit" });
    const calls = llm.calls.length;
    expect(last(await run(ctx))).toMatchObject({ cached: true, demo: false }); // тот же запрос — из кеша
    expect(llm.calls.length).toBe(calls);
  });

  it("отмена клиентом → error aborted, без демо", async () => {
    const ac = new AbortController();
    const { ctx } = liveCtx({ signal: ac.signal, search: new MockSearchProvider(() => new Promise(() => {})) });
    const p = run(ctx);
    setTimeout(() => ac.abort(), 20);
    expect(last(await p)).toMatchObject({ type: "error", code: "aborted" });
  });
});

describe("лимиты", () => {
  it("rate limit: окно скользит", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.take("ip").ok).toBe(true);
    expect(rl.take("ip").ok).toBe(true);
    const x = rl.take("ip");
    expect(x).toMatchObject({ ok: false, retryAfterS: 1 });
    expect(rl.take("other").ok).toBe(true);
    t = 1001;
    expect(rl.take("ip").ok).toBe(true);
  });

  it("суточный счётчик обнуляется со сменой дня", () => {
    let d = new Date("2026-11-24T10:00:00Z");
    const c = new DailyCounter(1, () => d);
    expect(c.tryTake()).toBe(true);
    expect(c.tryTake()).toBe(false);
    d = new Date("2026-11-25T00:00:01Z");
    expect(c.tryTake()).toBe(true);
  });

  it("конфиг: значения по умолчанию и прод", () => {
    expect(readApiConfig({})).toMatchObject({ demoMode: "auto", liveDailyLimit: 5, rateLimitMax: 5 });
    expect(readApiConfig({ NODE_ENV: "production" }).demoMode).toBe("on");
    expect(readApiConfig({ NODE_ENV: "production", DEMO_MODE: "auto" }).demoMode).toBe("auto");
    expect(readApiConfig({ DEMO_MODE: "мусор", LIVE_SEARCH_DAILY_LIMIT: "x" })).toMatchObject({ demoMode: "auto", liveDailyLimit: 5 });
    expect(readApiConfig({ LIVE_SEARCH_DAILY_LIMIT: "0" }).liveDailyLimit).toBe(0);
  });
});
