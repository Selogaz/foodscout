import { describe, expect, it } from "vitest";
import { rankSuppliers, SearchQuerySchema, type SearchQuery, type Supplier } from "@/domain";
import { supplierFixtures, fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import { AdviseInputSchema, DraftInputSchema, AdviceLlmSchema, buildFacts, factsForPrompt, fallbackAdvice, fallbackReasons, regionWarning, mergeLlmAdvice, reasonIsValid, type AdviceLlm } from "@/lib/advisor";
import { createApiState, readApiConfig, type ApiConfig } from "../api";
import { MockProvider } from "../llm/mock";
import { runAdvise, runDraft, type AssistContext } from "./index";

const query: SearchQuery = SearchQuerySchema.parse({
  category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
  product: "мука пшеничная в/с",
  location: { regionId: "moscow", cityId: "moscow" },
  needCertificates: ["gost"],
  maxMinOrder: { value: 1000, unit: "кг" },
  needDelivery: true,
});
const suppliers = supplierFixtures.slice(0, 4) as Supplier[];

const cfg = (over: Partial<ApiConfig> = {}): ApiConfig => ({ ...readApiConfig({ DEMO_MODE: "auto" }), ...over });
function ctx(llm: MockProvider | null, config = cfg()): AssistContext {
  return { config, state: createApiState(config), llm };
}
const ranked = () => rankSuppliers(suppliers, query);
const facts = () => ranked().map((r) => buildFacts(r, query));

describe("фолбэк без LLM", () => {
  it("DEMO_MODE=on: модель не вызывается, порядок по баллу, причины-шаблоны", async () => {
    const llm = new MockProvider(() => ({}));
    const a = await runAdvise({ query, suppliers }, ctx(llm, cfg({ demoMode: "on" })));
    expect(llm.calls).toHaveLength(0);
    expect(a.source).toBe("fallback");
    expect(a.fallbackReason).toBe("demo-mode");
    const scores = a.items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(a.items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    for (const i of a.items) expect(i.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it("нет ключа: фолбэк без вызова, причина no-key", async () => {
    const a = await runAdvise({ query, suppliers }, ctx(null));
    expect(a.source).toBe("fallback");
    expect(a.fallbackReason).toBe("no-key");
  });

  it("сбой модели: фолбэк с причиной failed", async () => {
    const llm = new MockProvider(() => {
      throw new Error("boom");
    });
    const a = await runAdvise({ query, suppliers }, ctx(llm));
    expect(a.source).toBe("fallback");
    expect(a.fallbackReason).toBe("failed");
  });

  it("суточный лимит вызовов LLM исчерпан: фолбэк без вызова", async () => {
    const llm = new MockProvider(() => ({}));
    const a = await runAdvise({ query, suppliers }, ctx(llm, cfg({ assistDailyLlmLimit: 0 })));
    expect(llm.calls).toHaveLength(0);
    expect(a.fallbackReason).toBe("limit");
  });

  it("каждое «почему» шаблона ссылается на реально заполненные поля", () => {
    const f = facts();
    const a = fallbackAdvice(f, query, "no-key");
    for (const item of a.items) {
      const fact = f.find((x) => x.id === item.id)!;
      for (const r of item.reasons) expect(reasonIsValid(r, fact)).toBe(true);
    }
  });
});

describe("схема ответа и сборка ответа модели", () => {
  const f = facts();
  const [a, b] = f;
  const good = (id: string, fields = ["score"]): AdviceLlm["order"][number] => ({
    id,
    reasons: [{ text: "Подходит по баллу.", fields: fields as never }],
    ask: [],
  });

  it("схема отклоняет пустые причины и неизвестные ключи полей", () => {
    expect(AdviceLlmSchema.safeParse({ order: [{ id: "x", reasons: [], ask: [] }] }).success).toBe(false);
    expect(AdviceLlmSchema.safeParse({ order: [{ id: "x", reasons: [{ text: "т", fields: ["phone_number"] }], ask: [] }] }).success).toBe(false);
    expect(AdviceLlmSchema.safeParse({ order: [good("x")] }).success).toBe(true);
  });

  it("выдуманный и повторный id отбрасываются, пропущенные дописываются по баллу", () => {
    const llm: AdviceLlm = { order: [good("выдуманный-id"), good(b.id), good(b.id), good(a.id)] };
    const adv = mergeLlmAdvice(llm, f, query);
    expect(adv.items.map((i) => i.id).slice(0, 2)).toEqual([b.id, a.id]);
    expect(new Set(adv.items.map((i) => i.id))).toEqual(new Set(f.map((x) => x.id)));
    expect(adv.items).toHaveLength(f.length);
    expect(adv.items.find((i) => i.id === "выдуманный-id")).toBeUndefined();
    expect(adv.items.slice(2).every((i) => i.source === "fallback")).toBe(true);
  });

  it("«почему» с ссылкой на поле, которого нет в карточке, заменяется шаблоном для этой позиции", () => {
    const [ranked0] = rankSuppliers([minimalSupplier], query);
    const m = buildFacts(ranked0, query);
    expect(m.fields.minOrder).toBeUndefined();
    const adv = mergeLlmAdvice(
      { order: [{ id: m.id, reasons: [{ text: "Минимальный заказ небольшой.", fields: ["minOrder"] }], ask: ["minOrder"] }] },
      [m],
      query,
    );
    expect(adv.items[0].source).toBe("fallback");
    expect(adv.items[0].reasons.every((r) => r.fields.every((k) => m.fields[k] !== undefined))).toBe(true);
  });

  it("число, которого нет в фактах, бракует «почему»", () => {
    const fact = f.find((x) => x.id === fullSupplier.id)!;
    expect(reasonIsValid({ text: "Минимальная партия — от 500 кг.", fields: ["minOrder"] }, fact)).toBe(true);
    expect(reasonIsValid({ text: "Минимальная партия — от 5 тонн, скидка 17%.", fields: ["minOrder"] }, fact)).toBe(false);
  });

  it("«что уточнить» оставляет только то, чего реально не хватает", () => {
    const fact = f.find((x) => x.id === fullSupplier.id)!;
    expect(fact.ask).not.toContain("minOrder");
    const adv = mergeLlmAdvice({ order: [{ id: fact.id, reasons: [{ text: "Подходит.", fields: ["score"] }], ask: ["minOrder", "certificates"] }] }, [fact], query);
    expect(adv.items[0].ask.map((x) => x.key)).toEqual(fact.ask.slice(0, 4));
  });

  it("полный путь с MockProvider: ответ модели проходит схему, источник llm", async () => {
    const full = rankSuppliers(suppliers, query);
    const llm = new MockProvider(({ schemaName }) => {
      expect(schemaName).toBe("advise_contact_order");
      return { order: full.map((r) => ({ id: r.supplier.id, reasons: [{ text: `Балл ${r.score.total} из 100.`, fields: ["score"] }], ask: [] })) };
    });
    const adv = await runAdvise({ query, suppliers }, ctx(llm));
    expect(llm.calls).toHaveLength(1);
    expect(adv.source).toBe("llm");
    expect(adv.items.map((i) => i.id)).toEqual(full.map((r) => r.supplier.id));
  });
});

describe("честность по региону", () => {
  it("поставщик из другого региона помечен, предупреждение называет число подтвердивших", () => {
    const kazan = SearchQuerySchema.parse({ ...query, location: { regionId: "tatarstan", cityId: null }, needDelivery: false });
    const f = rankSuppliers(suppliers, kazan).map((r) => buildFacts(r, kazan));
    const adv = fallbackAdvice(f, kazan, "no-key");
    const notOk = adv.items.filter((i) => i.region.state !== "ok");
    expect(notOk.length).toBeGreaterThan(0);
    expect(adv.regionWarning).toMatch(/подтвердил/);
    for (const i of notOk) expect(i.region.note).toBeTruthy();
  });

  it("регион подтверждён только адресом: так и сказано, а не «регион подтверждён»", () => {
    const f = facts().map((x) => ({ ...x, region: { state: "ok" as const, place: "Москва", note: null } }));
    const first = { ...f[0], pros: ["Адрес поставщика — Москва"], region: { ...f[0].region, addressOnly: true } };
    const reasons = fallbackReasons(first, query);
    expect(reasons[0].text).toMatch(/^Адрес поставщика в Москве, доставку в Москву/);
    const warn = regionWarning([first, ...f.slice(1)], query);
    expect(warn).toMatch(/только адрес/);
  });
});

describe("в промпт не попадают поля без источника", () => {
  it("значение без sourceUrl и пустые поля отсутствуют в фактах и тексте промпта", () => {
    const tampered = structuredClone(fullSupplier);
    tampered.description = { value: "СЕКРЕТНАЯ-ДОГАДКА-МОДЕЛИ", sourceUrl: null, confidence: "high" };
    tampered.contacts.phones = [{ value: "+7 000 НЕТ-ИСТОЧНИКА", sourceUrl: null, confidence: "high" }];
    const [r] = rankSuppliers([tampered], query);
    const fact = buildFacts(r, query);
    expect(fact.fields.description).toBeUndefined();
    expect(fact.fields.phones).toBeUndefined();
    const prompt = factsForPrompt([fact], query);
    expect(prompt).not.toContain("СЕКРЕТНАЯ-ДОГАДКА-МОДЕЛИ");
    expect(prompt).not.toContain("НЕТ-ИСТОЧНИКА");
    // «нет данных» не превращается в строки вроде null/undefined
    const [m] = rankSuppliers([minimalSupplier], query);
    const mp = factsForPrompt([buildFacts(m, query)], query);
    expect(mp).not.toMatch(/null|undefined/);
    const line = JSON.parse(mp.split("\n").at(-1)!) as { fields: Record<string, string> };
    expect(Object.keys(line.fields).sort()).toEqual(["score", "website"]);
  });

  it("запрос к модели содержит только факты, ключи и инструкции (user-промпт собран из фактов)", async () => {
    const llm = new MockProvider(() => ({ order: [{ id: "x", reasons: [{ text: "т", fields: ["score"] }], ask: [] }] }));
    await runAdvise({ query, suppliers }, ctx(llm));
    expect(llm.calls[0].user).toContain(fullSupplier.id);
    expect(llm.calls[0].user).not.toContain("sourceUrl");
  });
});

describe("черновик запроса КП", () => {
  it("без ключа: шаблон с товаром, объёмом, городом, вопросами по недостающему; mailto с адресом поставщика", async () => {
    const d = await runDraft({ query, supplier: fullSupplier, volume: "2 т в месяц" }, ctx(null));
    expect(d.source).toBe("fallback");
    expect(d.body).toContain("мука пшеничная в/с");
    expect(d.body).toContain("объём: 2 т в месяц");
    expect(d.body).toContain("доставка: Москва");
    expect(d.email).toBe("sales@mukomol.example.ru");
    expect(d.mailto).toMatch(/^mailto:sales@mukomol\.example\.ru\?subject=/);
    expect(decodeURIComponent(d.mailto!)).toContain("мука пшеничная");
  });

  it("поставщик без e-mail: mailto null; объём не выдумывается, а помечен заглушкой", async () => {
    const d = await runDraft({ query, supplier: minimalSupplier }, ctx(null));
    expect(d.mailto).toBeNull();
    expect(d.body).toContain("[укажите нужный объём]");
    expect(d.body).toMatch(/минимальный объём/i);
  });

  it("вступление модели с выдуманным числом или ссылкой отбраковывается", async () => {
    const bad = new MockProvider(() => ({ intro: "Видели, что вы работаете с 1987 года и даёте скидку 33%, пишем вам." }));
    const d = await runDraft({ query, supplier: fullSupplier }, ctx(bad));
    expect(d.source).toBe("fallback");
    expect(d.body).not.toContain("1987");
    const ok = new MockProvider(() => ({ intro: "Мы подбираем поставщика муки и увидели, что вы производите муку и крупы для пекарен." }));
    const d2 = await runDraft({ query, supplier: fullSupplier }, ctx(ok));
    expect(d2.source).toBe("llm");
    expect(d2.body).toContain("производите муку");
  });

  it("падеж места: по умолчанию «в Москве», своё место пользователя — «в <как введено>»", async () => {
    const def = await runDraft({ query, supplier: minimalSupplier }, ctx(null));
    expect(def.body).toContain("доставки в Москве");
    const own = await runDraft({ query, supplier: minimalSupplier, deliveryCity: "Тула" }, ctx(null));
    expect(own.body).toContain("доставка: Тула");
    expect(own.body).toContain("доставки в Тула");
  });

  it("DEMO_MODE=on: без вызова модели", async () => {
    const llm = new MockProvider(() => ({ intro: "x".repeat(30) }));
    const d = await runDraft({ query, supplier: fullSupplier }, ctx(llm, cfg({ demoMode: "on" })));
    expect(llm.calls).toHaveLength(0);
    expect(d.fallbackReason).toBe("demo-mode");
  });
});

describe("границы входа помощника", () => {
  it("проверяет строки и контакты в обеих схемах", () => {
    for (const supplier of [
      { ...fullSupplier, name: "я".repeat(301) },
      { ...fullSupplier, contacts: { ...fullSupplier.contacts, phones: Array(6).fill(fullSupplier.contacts.phones[0]) } },
    ]) {
      expect(AdviseInputSchema.safeParse({ query, suppliers: [supplier] }).success).toBe(false);
      expect(DraftInputSchema.safeParse({ query, supplier }).success).toBe(false);
    }
    expect(cfg().assistDailyLlmLimit).toBe(100);
  });

  it("длинные URL (до 2048 символов) проходят, прочие строки остаются в пределах 300", () => {
    const longUrl = (n: number) => `https://example.com/catalog?${"x".repeat(n - "https://example.com/catalog?".length)}`;
    const url = longUrl(2048);
    expect(url).toHaveLength(2048);
    const withUrls = {
      ...fullSupplier,
      website: { ...fullSupplier.website, value: url, sourceUrl: url },
      sources: [...fullSupplier.sources, { ...fullSupplier.sources[0], url }],
    };
    expect(AdviseInputSchema.safeParse({ query, suppliers: [withUrls] }).success).toBe(true);
    expect(DraftInputSchema.safeParse({ query, supplier: withUrls }).success).toBe(true);
    const tooLong = longUrl(2049);
    const bad = { ...withUrls, website: { ...withUrls.website, value: tooLong, sourceUrl: tooLong } };
    expect(AdviseInputSchema.safeParse({ query, suppliers: [bad] }).success).toBe(false);
  });

  it("ограничивает факты и использует шаблон при переполнении общего промпта", async () => {
    const text = "я".repeat(300);
    const cards = Array.from({ length: 8 }, (_, i) => ({
      ...fullSupplier, id: String(i), name: text,
      contacts: { ...fullSupplier.contacts, address: { ...fullSupplier.contacts.address, value: text } },
      minOrder: { ...fullSupplier.minOrder, value: { ...fullSupplier.minOrder.value!, rawText: text } },
      priceHint: { ...fullSupplier.priceHint, value: { ...fullSupplier.priceHint.value!, rawText: text } },
      description: { ...fullSupplier.description, value: text },
    }));
    const [ranked] = rankSuppliers(cards, query);
    const facts = buildFacts({ ...ranked, supplier: { ...ranked.supplier, name: text + text } }, query);
    expect(facts.name).toHaveLength(300);
    const llm = new MockProvider(() => ({}));
    expect((await runAdvise({ suppliers: cards, query }, ctx(llm))).fallbackReason).toBe("limit");
    expect(llm.calls).toHaveLength(0);
  });
});
