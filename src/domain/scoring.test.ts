import { describe, expect, it } from "vitest";
import { validQueryFixtures } from "./__fixtures__/queries";
import {
  frozenSupplier,
  fullSupplier,
  minimalSupplier,
  spicesSupplier,
  supplierFixtures,
} from "./__fixtures__/suppliers";
import { emptyField, field } from "./field";
import { SearchQuerySchema, type SearchQueryInput } from "./query";
import { rankSuppliers, SCORING_CONFIG, scoreSupplier } from "./scoring";
import type { Supplier } from "./supplier";

const q = (input: SearchQueryInput) => SearchQuerySchema.parse(input);
const moscowFlour = q(validQueryFixtures.catalogMoscow!);
const krasnodarFrozen = q({
  category: { kind: "catalog", categoryId: "frozen", subcategoryId: "frozen-veg" },
  product: "замороженные ягоды",
  location: { regionId: "krasnodar-krai", cityId: "krasnodar" },
  needCertificates: ["halal"],
  needDelivery: true,
});
const novosibirskFree = q({
  category: { kind: "free", text: "упаковка для кофе" },
  location: { regionId: "novosibirsk-oblast", cityId: "novosibirsk" },
});

describe("scoreSupplier", () => {
  it("веса критериев в сумме дают 100", () => {
    const sum = Object.values(SCORING_CONFIG.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("полное совпадение даёт высокий балл и пояснения «за»", () => {
    const r = scoreSupplier(fullSupplier, moscowFlour);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.pros).toContain("Доставка в Москва указана на сайте");
    expect(r.pros.some((p) => p.includes("ГОСТ") && p.includes("ХАССП"))).toBe(true);
    // нарушений нет; в cons — только предупреждение о низкой уверенности одного поля
    expect(r.cons.filter((c) => !c.startsWith("Полей с низкой уверенностью"))).toEqual([]);
  });

  it("чужая категория: низкий балл и причина в cons", () => {
    const r = scoreSupplier(frozenSupplier, moscowFlour);
    expect(r.total).toBeLessThan(20);
    expect(r.cons.some((c) => c.startsWith("Категория поставщика не совпадает"))).toBe(true);
  });

  it("нарушение фильтра даёт cons: нет нужного сертификата", () => {
    const r = scoreSupplier(spicesSupplier, q({ ...validQueryFixtures.catalogMoscow!, needCertificates: ["halal"] }));
    expect(r.cons).toContain("Нет сертификата среди указанных: Халяль");
  });

  it("нарушение фильтра даёт cons: минимальный заказ больше желаемого (с пересчётом единиц)", () => {
    const heavy: Supplier = {
      ...fullSupplier,
      minOrder: field({ quantity: 5, unit: "т", rawText: "От 5 тонн" }, "https://mukomol.example.ru/opt"),
    };
    const r = scoreSupplier(heavy, moscowFlour); // желаемо до 1000 кг
    expect(r.cons).toContain("Минимальный заказ 5 т больше желаемых 1000 кг");
    expect(scoreSupplier(heavy, moscowFlour).total).toBeLessThan(scoreSupplier(fullSupplier, moscowFlour).total);
  });

  it("нет данных: попадает в missing, а не в cons", () => {
    const r = scoreSupplier(minimalSupplier, moscowFlour);
    expect(r.missing).toContain("Нет данных о минимальном заказе");
    expect(r.missing).toContain("Нет данных о сертификатах");
    expect(r.cons.some((c) => c.includes("Нет данных"))).toBe(false);
  });

  it("город не в зоне доставки: cons с перечнем регионов поставщика", () => {
    const r = scoreSupplier(fullSupplier, novosibirskFree);
    expect(r.cons.some((c) => c.startsWith("Доставка в Новосибирск не указана (работает: Москва"))).toBe(true);
  });

  it("монотонность: добавление нужного сертификата не снижает балл", () => {
    const bare: Supplier = { ...fullSupplier, certificates: emptyField() };
    const withGost: Supplier = {
      ...fullSupplier,
      certificates: field([{ type: "gost", title: null, documentUrl: null }], "https://mukomol.example.ru/docs"),
    };
    const withBoth = fullSupplier;
    const a = scoreSupplier(bare, moscowFlour).total;
    const b = scoreSupplier(withGost, moscowFlour).total;
    const c = scoreSupplier(withBoth, moscowFlour).total;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(c).toBeGreaterThanOrEqual(b);
    // сертификат с низкой уверенностью тоже не может уменьшить итог
    const low: Supplier = {
      ...fullSupplier,
      certificates: field([{ type: "other", title: null, documentUrl: null }], "https://mukomol.example.ru/docs", "low"),
    };
    expect(scoreSupplier(low, moscowFlour).total).toBeGreaterThanOrEqual(a);
  });

  it("пустая карточка не выше заполненной (во всех запросах)", () => {
    for (const query of [moscowFlour, krasnodarFrozen, novosibirskFree]) {
      for (const s of supplierFixtures) {
        const empty: Supplier = {
          ...minimalSupplier,
          id: "empty",
          categories: s.categories,
          website: emptyField(),
        };
        expect(scoreSupplier(empty, query).total).toBeLessThanOrEqual(scoreSupplier(s, query).total);
      }
    }
  });

  it("низкая уверенность даёт меньший вклад, чем высокая", () => {
    const lowRegions: Supplier = {
      ...fullSupplier,
      contacts: { ...fullSupplier.contacts, address: emptyField() },
      workRegions: emptyField(),
      delivery: { ...fullSupplier.delivery, regions: field(["moscow"], "https://mukomol.example.ru/delivery", "low") },
    };
    const hi = scoreSupplier(
      { ...lowRegions, delivery: { ...lowRegions.delivery, regions: field(["moscow"], "https://mukomol.example.ru/delivery") } },
      moscowFlour,
    );
    const lo = scoreSupplier(lowRegions, moscowFlour);
    expect(lo.total).toBeLessThan(hi.total);
    expect(lo.pros.some((p) => p.includes("данные ненадёжны"))).toBe(true);
  });

  it("детерминизм: повторный вызов и независимость от порядка вызовов", () => {
    const a = JSON.stringify(supplierFixtures.map((s) => scoreSupplier(s, moscowFlour)));
    const b = JSON.stringify([...supplierFixtures].reverse().reverse().map((s) => scoreSupplier(s, moscowFlour)));
    expect(a).toBe(b);
  });

  it("итог всегда целое 0–100, критерий «фильтры» исключается, если фильтров нет", () => {
    for (const query of [moscowFlour, krasnodarFrozen, novosibirskFree]) {
      for (const s of supplierFixtures) {
        const r = scoreSupplier(s, query);
        expect(Number.isInteger(r.total)).toBe(true);
        expect(r.total).toBeGreaterThanOrEqual(0);
        expect(r.total).toBeLessThanOrEqual(100);
      }
    }
    const filters = scoreSupplier(fullSupplier, novosibirskFree).breakdown.find((b) => b.id === "filters");
    expect(filters?.applicable).toBe(false);
  });
});

describe("rankSuppliers", () => {
  it("сортирует по убыванию балла и нумерует места", () => {
    const ranked = rankSuppliers(supplierFixtures, moscowFlour);
    expect(ranked[0]?.supplier.id).toBe(fullSupplier.id);
    expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score.total).toBeGreaterThanOrEqual(ranked[i]!.score.total);
    }
  });

  it("стабильна при равенстве: исходный порядок сохраняется", () => {
    const a: Supplier = { ...fullSupplier, id: "a", name: "A" };
    const b: Supplier = { ...fullSupplier, id: "b", name: "B" };
    const c: Supplier = { ...fullSupplier, id: "c", name: "C" };
    expect(rankSuppliers([b, c, a], moscowFlour).map((r) => r.supplier.id)).toEqual(["b", "c", "a"]);
    expect(rankSuppliers([a, b, c], moscowFlour).map((r) => r.supplier.id)).toEqual(["a", "b", "c"]);
  });

  it("не мутирует входной массив", () => {
    const input = [...supplierFixtures];
    rankSuppliers(input, krasnodarFrozen);
    expect(input).toEqual([...supplierFixtures]);
  });

  it("помечает «лучший по критерию» и не помечает критерий без лидера", () => {
    const ranked = rankSuppliers(supplierFixtures, krasnodarFrozen);
    const top = ranked[0]!;
    expect(top.supplier.id).toBe(frozenSupplier.id);
    expect(top.bestFor).toContain("category");
    expect(top.bestFor).toContain("region");
    // у остальных нет балла по категории — «лучшим» по ней может быть только лидер
    expect(ranked.slice(1).some((r) => r.bestFor.includes("region"))).toBe(false);
    // если критерий у всех равен — отметок нет
    const same = rankSuppliers([fullSupplier, { ...fullSupplier, id: "x" }], moscowFlour);
    expect(same.every((r) => r.bestFor.length === 0)).toBe(true);
  });

  it("пустой список даёт пустой результат", () => {
    expect(rankSuppliers([], moscowFlour)).toEqual([]);
  });
});
