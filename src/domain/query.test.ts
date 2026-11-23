import { describe, expect, it } from "vitest";
import { normalizeLocation, SearchQuerySchema, yandexLrForLocation } from "./query";
import { validQueryFixtures } from "./__fixtures__/queries";

describe("normalizeLocation", () => {
  it.each([
    ["Москва", { regionId: "moscow", cityId: "moscow" }],
    ["  г. Екатеринбург ", { regionId: "sverdlovsk-oblast", cityId: "yekaterinburg" }],
    ["ЕКБ", { regionId: "sverdlovsk-oblast", cityId: "yekaterinburg" }],
    ["ростов-на-дону", { regionId: "rostov-oblast", cityId: "rostov-on-don" }],
    ["Нижний  Новгород", { regionId: "nizhny-novgorod-oblast", cityId: "nizhny-novgorod" }],
    ["Питер", { regionId: "saint-petersburg", cityId: "saint-petersburg" }],
    ["Краснодарский край", { regionId: "krasnodar-krai", cityId: null }],
    ["подмосковье", { regionId: "moscow-oblast", cityId: null }],
  ])("%s", (input, expected) => {
    expect(normalizeLocation(input)).toEqual(expected);
  });

  it("неизвестное место и пустая строка дают null", () => {
    expect(normalizeLocation("Атлантида")).toBeNull();
    expect(normalizeLocation("   ")).toBeNull();
  });
});

describe("yandexLrForLocation", () => {
  it("город приоритетнее региона", () => {
    expect(yandexLrForLocation({ regionId: "novosibirsk-oblast", cityId: "novosibirsk" })).toBe(65);
  });
  it("регион без подтверждённого кода и без города даёт null", () => {
    expect(yandexLrForLocation({ regionId: "tatarstan", cityId: null })).toBeNull();
  });
  it("регион с кодом", () => {
    expect(yandexLrForLocation({ regionId: "moscow-oblast", cityId: null })).toBe(1);
  });
});

describe("SearchQuerySchema", () => {
  it("валидные запросы проходят, значения по умолчанию подставляются", () => {
    const a = SearchQuerySchema.parse(validQueryFixtures.catalogMoscow);
    expect(a.needDelivery).toBe(true);
    const b = SearchQuerySchema.parse(validQueryFixtures.freeTextRegion);
    expect(b.needCertificates).toEqual([]);
    expect(b.maxMinOrder).toBeNull();
    expect(b.priceImportance).toBe("medium");
  });

  it.each([
    ["неизвестная категория", { category: { kind: "catalog", categoryId: "nope" } }],
    ["чужая подкатегория", { category: { kind: "catalog", categoryId: "packaging", subcategoryId: "water" } }],
    ["слишком короткий свободный текст", { category: { kind: "free", text: "а" } }],
    ["неизвестный регион", { location: { regionId: "mars", cityId: null } }],
    ["город не из региона", { location: { regionId: "moscow", cityId: "kazan" } }],
    ["неизвестный тип сертификата", { needCertificates: ["fda"] }],
    ["отрицательный МОЗ", { maxMinOrder: { value: -1, unit: "кг" } }],
    ["неверная важность цены", { priceImportance: "extreme" }],
    ["лишнее поле", { foo: 1 }],
  ])("отклоняет: %s", (_name, patch) => {
    const r = SearchQuerySchema.safeParse({ ...validQueryFixtures.catalogMoscow, ...patch });
    expect(r.success).toBe(false);
  });
});
