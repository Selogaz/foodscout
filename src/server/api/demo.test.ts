import { describe, expect, it } from "vitest";
import { SearchQuerySchema, SupplierSchema } from "@/domain";
import { DEMO_EXAMPLES, DEMO_RUNS } from "@/data/demo";
import { buildQuery, EMPTY_FORM } from "@/lib/formState";
import { matchDemoRun, pickDemoRun } from "./demo";
import { countValuesWithoutSource, DEMO_EXCLUDED, isPersonalEmail, sanitizeSupplier } from "./demo-sanitize";

const q = (category: string, location: string, product = "") => {
  const r = buildQuery({ ...EMPTY_FORM, category, product, location });
  if (!r.ok) throw new Error("запрос не собрался");
  return r.query;
};

describe("записанный демо-набор", () => {
  it("на каждый пример есть запись, 7–8 запросов, даты и запросы валидны", () => {
    expect(DEMO_RUNS.length).toBeGreaterThanOrEqual(7);
    expect(DEMO_RUNS.map((r) => r.id)).toEqual(DEMO_EXAMPLES.map((e) => e.id));
    for (const r of DEMO_RUNS) {
      expect(Number.isNaN(Date.parse(r.recordedAt)), r.id).toBe(false);
      expect(() => SearchQuerySchema.parse(r.query), r.id).not.toThrow();
      expect(r.suppliers.length, r.id).toBeGreaterThan(0);
    }
  });

  it("карточки проходят схему, у каждого значения есть источник, личных данных и розницы нет", () => {
    for (const r of DEMO_RUNS) {
      for (const s of r.suppliers) {
        expect(() => SupplierSchema.parse(s), `${r.id}/${s.id}`).not.toThrow();
        expect(countValuesWithoutSource(s), `${r.id}/${s.id}`).toBe(0);
        for (const e of s.contacts.emails) expect(isPersonalEmail(e.value!), e.value!).toBe(false);
        expect(s.website.value, s.id).not.toMatch(/example\./);
        expect(s.name).not.toMatch(/^Тест /);
        expect(s.name).not.toMatch(/^ИП\b/);
        for (const d of Object.keys(DEMO_EXCLUDED)) expect(s.website.value).not.toContain(d);
      }
    }
  });
});

describe("подбор демо-прогона", () => {
  it("каждый чип-пример попадает точно в свою запись", () => {
    for (const ex of DEMO_EXAMPLES) {
      const built = buildQuery({ ...EMPTY_FORM, category: ex.category, product: ex.product, location: ex.location });
      if (!built.ok) throw new Error(ex.id);
      const { run, match } = matchDemoRun(built.query);
      expect(run.id).toBe(ex.id);
      expect(match).toBe("exact");
    }
  });

  it("фильтры не мешают точному совпадению и влияют на скоринг", () => {
    const a = pickDemoRun(q("Мука, крупы, злаки", "Краснодар", "мука пшеничная высшего сорта"));
    expect(a.info.match).toBe("exact");
    const b = pickDemoRun({ ...q("Мука, крупы, злаки", "Краснодар", "мука пшеничная высшего сорта"), needDelivery: true, needCertificates: ["gost"] });
    expect(b.info.match).toBe("exact");
    expect(b.results.some((s) => s.bestFor.length)).toBe(true);
    expect(b.query.needCertificates).toEqual(["gost"]);
  });

  it("другой город той же категории → ближайший с пометкой", () => {
    const r = pickDemoRun(q("Мука, крупы, злаки", "Ростов-на-Дону", "мука"));
    expect(r.info.match).toBe("nearest");
    expect(r.results.every((s) => s.bestFor.length === 0)).toBe(true);
    expect(r.info.runId).toBe("muka-krasnodar");
    expect(r.info.requestedLabel).toContain("Ростов");
    expect(r.info.shownLabel).toContain("Краснодар");
  });

  it("свободный текст со знакомым словом → ближайший по словам", () => {
    expect(matchDemoRun(q("моцарелла сыр", "Казань")).run.id).toBe("syr-picceriya-kazan");
  });

  it("ничего общего → прогон по умолчанию", () => {
    const r = pickDemoRun(q("Вода", "Владивосток"));
    expect(r.info.match).toBe("default");
    expect(r.results.every((s) => s.bestFor.length === 0)).toBe(true);
    expect(r.info.runId).toBe(DEMO_RUNS[0].id);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it("ответ содержит реальные данные и дату записи, без заглушек example", () => {
    const r = pickDemoRun(q("Упаковка", "Москва"));
    expect(r.info.recordedAt).toMatch(/^2026-/);
    expect(r.warnings.join(" ")).toMatch(/записаны \d\d\.\d\d\.\d{4}/);
    for (const x of r.results) expect(x.supplier.website.value).not.toMatch(/example/);
  });
});

describe("санитария", () => {
  it("личная почта: имя.фамилия и явные исключения, общие ящики не трогаем", () => {
    expect(isPersonalEmail("s.garmotko@grossfood.ru")).toBe(true);
    expect(isPersonalEmail("galina@pelmeni.delivery")).toBe(true);
    expect(isPersonalEmail("info@marr.ru")).toBe(false);
    expect(isPersonalEmail("zakaz@e-sweets.ru")).toBe(false);
  });

  it("убирает личную почту, мессенджер на чужой номер и адрес с квартирой", () => {
    const base = DEMO_RUNS[0].suppliers[0];
    const src = base.sources[0].url;
    const dirty = structuredClone(base);
    dirty.contacts.emails = [{ value: "ivan.petrov@firma.ru", sourceUrl: src, confidence: "high" }, { value: "info@firma.ru", sourceUrl: src, confidence: "high" }];
    dirty.contacts.messengers = [{ value: { kind: "telegram", handle: "+79991112233" }, sourceUrl: src, confidence: "high" }];
    dirty.contacts.address = { value: "Москва, ул. Мира, д. 1, кв. 30", sourceUrl: src, confidence: "high" };
    const { supplier, removed } = sanitizeSupplier(dirty);
    expect(supplier.contacts.emails.map((e) => e.value)).toEqual(["info@firma.ru"]);
    expect(supplier.contacts.messengers).toEqual([]);
    expect(supplier.contacts.address.value).toBeNull();
    expect(removed).toHaveLength(3);
  });
});
