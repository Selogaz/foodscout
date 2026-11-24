import { describe, expect, it, vi } from "vitest";
import { SupplierSchema } from "@/domain";
import { MockProvider } from "../llm/mock";
import { LlmError } from "../llm/types";
import { MockSearchProvider } from "../search/mock";
import { EXTRACTIONS, fakeFetch, NORMALIZE_ANSWER, SEARCH_HITS, SITES } from "./__fixtures__/sites";
import { runSearch } from "./run-search";
import type { ProgressEvent, SearchInput } from "./types";

const INPUT: SearchInput = {
  category: { kind: "free", text: "упаковка для кофе" },
  product: "",
  location: "мск",
};

function extractionFor(user: string) {
  const domain = Object.keys(EXTRACTIONS).find((d) => user.includes(`URL: https://${d}`));
  if (!domain) throw new Error("нет фикстуры для страницы");
  return EXTRACTIONS[domain];
}

const llm = () =>
  new MockProvider(({ schemaName, user }) => (schemaName === "normalize_query" ? NORMALIZE_ANSWER : extractionFor(user)));

const deps = (over: Partial<Parameters<typeof runSearch>[2]> = {}) => ({
  llm: llm(),
  search: new MockSearchProvider(() => SEARCH_HITS),
  fetchImpl: fakeFetch(SITES),
  now: () => new Date("2026-11-24T10:00:00+03:00"),
  ...over,
});

describe("runSearch на моках", () => {
  it("пайплайн целиком: нормализация → кандидаты → страницы → карточки → дедуп → валидация", async () => {
    const events: ProgressEvent[] = [];
    const search = new MockSearchProvider(() => SEARCH_HITS);
    const r = await runSearch(INPUT, (e) => events.push(e), deps({ search }));

    // Место «мск» нормализовано словарём, lr — Москва; фразы — с городом
    expect(r.normalized.query.location).toEqual({ regionId: "moscow", cityId: "moscow" });
    expect(r.normalized.lr).toBe(213);
    expect(r.normalized.searchPhrases[0]).toBe("упаковка для кофе оптом москва");
    expect(search.calls.every((c) => c.regionLr === 213)).toBe(true);
    expect(search.calls).toHaveLength(3);

    // Авито и подборка «Топ-10» отфильтрованы; три сайта, один — дубль по телефону
    expect(r.stats.candidates).toBe(3);
    expect(r.suppliers.map((s) => s.id).sort()).toEqual(["kofepack-example-ru", "upak-dvor-example-ru"]);
    expect(r.duplicates).toEqual([{ kept: "kofepack-example-ru", removed: "kofepack-msk-example-com", by: "phone" }]);

    for (const s of r.suppliers) expect(SupplierSchema.safeParse(s).success).toBe(true);
    const k = r.suppliers.find((s) => s.id === "kofepack-example-ru")!;
    expect(k.name).toBe("Тест Кофепак");
    expect(k.contacts.phones.map((p) => p.value)).toEqual(["+7 (495) 000-11-22"]);
    expect(k.contacts.phones[0].sourceUrl).toBe("https://kofepack.example.ru/kontakty/");
    expect(k.contacts.emails[0].value).toBe("sales@kofepack.example.ru");
    expect(k.contacts.messengers[0].value).toEqual({ kind: "telegram", handle: "@kofepack_test" });
    expect(k.minOrder.value).toEqual({ quantity: 1000, unit: "шт", rawText: "Минимальная партия — от 1000 шт." });
    expect(k.delivery.regions.value).toEqual(["moscow", "moscow-oblast", "Россия"]);
    expect(k.delivery.pickup.value).toBe(true);
    expect(k.categories).toEqual(["packaging", "film-bags"]);
    // Карточка без категории со страницы берёт категорию, которую определила нормализация
    expect(r.suppliers.find((s) => s.id === "upak-dvor-example-ru")!.categories).toEqual(["packaging"]);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("stage");
    expect(types).toContain("normalized");
    expect(types).toContain("candidates");
    expect(types.filter((t) => t === "candidate-done")).toHaveLength(3);
    expect(types.at(-1)).toBe("done");
    expect(r.stats.searchRequests).toBe(3);
    expect(r.stats.llmCalls).toBe(4);
  });

  it("значение без подтверждения на странице отбрасывается и попадает в dropped", async () => {
    const r = await runSearch(INPUT, () => {}, deps());
    const k = r.suppliers.find((s) => s.id === "kofepack-example-ru")!;
    // Телефон с выдуманной цитатой
    expect(k.contacts.phones.some((p) => p.value?.includes("999-99-99"))).toBe(false);
    // ХАССП: цитаты нет на сайте; ISO — есть
    expect(k.certificates.value).toEqual([{ type: "iso", title: "ISO 9001", documentUrl: null }]);
    // Цена: число 10 не стоит в цитате «от 12 руб.» → поле «нет данных», а не догадка
    expect(k.priceHint).toEqual({ value: null, sourceUrl: null, confidence: null });
    // «Казань» не упомянута в цитате о доставке
    expect(k.delivery.regions.value).not.toContain("kazan");

    const outcome = r.outcomes.find((o) => o.domain === "kofepack.example.ru");
    expect(outcome?.status).toBe("supplier");
    const dropped = outcome && "dropped" in outcome ? outcome.dropped.map((d) => `${d.path}: ${d.reason}`) : [];
    expect(dropped).toEqual(
      expect.arrayContaining([
        "contacts.phones.1: цитата не найдена на страницах сайта",
        "certificates.1: цитата не найдена на страницах сайта",
        "priceHint.min: числа нет в цитате",
        "priceHint: в цитате нет указанной цены",
        "delivery.regions: место не упомянуто в цитате",
      ]),
    );
    expect(r.stats.droppedFields).toBeGreaterThanOrEqual(5);
  });

  it.each([
    { quantity: 1000, unit: "шт", quote: "Бесплатная доставка при заказе от 1000 шт." },
    { quantity: 1000, unit: "шт", quote: "Самовывоз от 1000 шт." },
    { quantity: 2000, unit: "кг", quote: "Минимальная партия — от 1000 шт." },
  ])("отбрасывает неподтверждённый минимум и цену 0", async (order) => {
    const url = "https://kofepack.example.ru/";
    const priceQuote = "Цена товара 0 руб. 550 руб.";
    const sites = { ...SITES, [url]: SITES[url].replace("</body>", `<p>${order.quote}</p><p>${priceQuote}</p></body>`) };
    const model = new MockProvider(({ schemaName, user }) => {
      if (schemaName === "normalize_query") return NORMALIZE_ANSWER;
      const extraction = extractionFor(user);
      if (!user.includes(`URL: ${url}`)) return extraction;
      return { ...extraction, minOrder: { ...order, url }, price: { min: 0, max: 550, unit: null, currency: "RUB", quote: priceQuote, url } };
    });
    const run = await runSearch(INPUT, () => {}, deps({ llm: model, fetchImpl: fakeFetch(sites) }));
    const supplier = run.suppliers.find((s) => s.id === "kofepack-example-ru")!;
    expect(supplier.minOrder.value).toBeNull();
    expect(supplier.priceHint.value).toBeNull();
  });

  it("почта и телефон со страницы, но не из цитаты — принимаются с уверенностью medium", async () => {
    const ex = structuredClone(EXTRACTIONS["upak-dvor.example.ru"]);
    ex.emails = [{ value: "info@upak-dvor.example.ru", quote: "Компания «Тест Упак-Двор»", url: "https://upak-dvor.example.ru/contacts" }];
    ex.phones = [
      { value: "8 (495) 000-33-44", quote: "Компания «Тест Упак-Двор»", url: "https://upak-dvor.example.ru/contacts" },
      { value: "8 (495) 000-77-77", quote: "Компания «Тест Упак-Двор»", url: "https://upak-dvor.example.ru/contacts" },
    ];
    const provider = new MockProvider(({ schemaName, user }) => {
      if (schemaName === "normalize_query") return NORMALIZE_ANSWER;
      if (user.includes("URL: https://upak-dvor.example.ru")) return ex;
      return extractionFor(user);
    });
    const r = await runSearch(INPUT, () => {}, deps({ llm: provider }));
    const u = r.suppliers.find((s) => s.id === "upak-dvor-example-ru")!;
    expect(u.contacts.emails).toEqual([{ value: "info@upak-dvor.example.ru", sourceUrl: "https://upak-dvor.example.ru/contacts", confidence: "medium" }]);
    // Номера 000-77-77 на странице нет — отброшен
    expect(u.contacts.phones.map((p) => [p.value, p.confidence])).toEqual([["8 (495) 000-33-44", "medium"]]);
  });

  it("таймаут одного кандидата не роняет поиск", async () => {
    const events: ProgressEvent[] = [];
    const r = await runSearch(INPUT, (e) => events.push(e), deps({
      fetchImpl: fakeFetch(SITES, { hang: ["upak-dvor.example.ru"] }),
      limits: { pageTimeoutMs: 50 },
    }));
    const failed = r.outcomes.find((o) => o.domain === "upak-dvor.example.ru");
    expect(failed?.status).toBe("failed");
    expect(failed && "error" in failed ? failed.error : "").toMatch(/таймаут|не уложился/);
    expect(r.suppliers.map((s) => s.id)).toEqual(["kofepack-example-ru"]);
    expect(r.stats.failed).toBe(1);
    expect(events.some((e) => e.type === "candidate-failed" && e.domain === "upak-dvor.example.ru")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("общий срок вышел на этапе кандидатов: отдаём то, что успели собрать", async () => {
    const events: ProgressEvent[] = [];
    const r = await runSearch(INPUT, (e) => events.push(e), deps({
      fetchImpl: fakeFetch(SITES, { hang: ["upak-dvor.example.ru"] }),
      limits: { pageTimeoutMs: 60_000, candidateTimeoutMs: 60_000 },
    }), { deadline: AbortSignal.timeout(300) });
    expect(r.timedOut).toBe(true);
    expect(r.suppliers.map((s) => s.id)).toEqual(["kofepack-example-ru"]);
    expect(r.outcomes.find((o) => o.domain === "upak-dvor.example.ru")).toMatchObject({ status: "failed", error: "не хватило времени" });
    expect(r.warnings.join(" ")).toMatch(/по времени/);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("без превышения срока поиск не помечается неполным", async () => {
    const r = await runSearch(INPUT, () => {}, deps(), { deadline: AbortSignal.timeout(30_000) });
    expect(r.timedOut).toBe(false);
  });

  it("невалидный ответ модели по одному сайту не роняет поиск", async () => {
    const provider = new MockProvider(({ schemaName, user }) => {
      if (schemaName === "normalize_query") return NORMALIZE_ANSWER;
      if (user.includes("URL: https://upak-dvor.example.ru")) return { isSupplier: "да" };
      return extractionFor(user);
    });
    const r = await runSearch(INPUT, () => {}, deps({ llm: provider }));
    expect(r.outcomes.find((o) => o.domain === "upak-dvor.example.ru")?.status).toBe("failed");
    expect(r.suppliers).toHaveLength(1);
  });

  it("сайт, который модель признала не поставщиком, не попадает в выдачу", async () => {
    const provider = new MockProvider(({ schemaName, user }) => {
      if (schemaName === "normalize_query") return NORMALIZE_ANSWER;
      if (user.includes("URL: https://upak-dvor.example.ru")) {
        return { ...EXTRACTIONS["upak-dvor.example.ru"], isSupplier: false, notSupplierReason: "каталог компаний" };
      }
      return extractionFor(user);
    });
    const r = await runSearch(INPUT, () => {}, deps({ llm: provider }));
    expect(r.outcomes.find((o) => o.domain === "upak-dvor.example.ru")).toMatchObject({ status: "rejected", reason: "каталог компаний" });
  });

  it("ошибка доступа к модели (401) останавливает поиск понятной ошибкой", async () => {
    const provider = new MockProvider(({ schemaName }) => {
      if (schemaName === "normalize_query") return NORMALIZE_ANSWER;
      throw new LlmError("LLM HTTP 401: Unauthorized", "auth", 401);
    });
    await expect(runSearch(INPUT, () => {}, deps({ llm: provider }))).rejects.toMatchObject({ kind: "auth" });
  });

  it("сбой модели на нормализации — фолбэк на исходные слова", async () => {
    const provider = new MockProvider(({ schemaName, user }) => {
      if (schemaName === "normalize_query") throw new LlmError("timeout", "timeout");
      return extractionFor(user);
    });
    const r = await runSearch({ ...INPUT, location: { regionId: "moscow", cityId: "moscow" } }, () => {}, deps({ llm: provider }));
    expect(r.normalized.searchPhrases[0]).toBe("упаковка для кофе оптом москва");
    expect(r.normalized.notes.join(" ")).toMatch(/не удалось/);
    expect(r.suppliers.length).toBeGreaterThan(0);
  });
});

it("подробности ошибок провайдеров остаются в серверном журнале", async () => {
  const diagnostic = "provider diagnostic fixture";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    let searches = 0;
    const providers = deps({
      search: new MockSearchProvider(() => {
        if (searches++ === 0) throw new Error(diagnostic);
        return SEARCH_HITS;
      }),
      llm: new MockProvider(() => { throw new LlmError(diagnostic, "network"); }),
    });
    const events: ProgressEvent[] = [];
    const run = await runSearch(INPUT, (e) => events.push(e), providers);
    expect(run.warnings.length).toBeGreaterThan(0);
    expect(run.outcomes.some((o) => o.status === "failed")).toBe(true);
    expect(JSON.stringify([events, run])).not.toContain(diagnostic);
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
