import { describe, expect, it } from "vitest";
import { SupplierSchema } from "./supplier";
import { emptyField, field } from "./field";
import { fullSupplier, minimalSupplier, supplierFixtures } from "./__fixtures__/suppliers";
import { REGIONS } from "./catalog";

const clone = <T>(x: T): T => structuredClone(x);

describe("Supplier: фикстуры", () => {
  it("6–8 фикстур, все проходят схему, помечены как тестовые", () => {
    expect(supplierFixtures.length).toBeGreaterThanOrEqual(6);
    expect(supplierFixtures.length).toBeLessThanOrEqual(8);
    const ids = new Set<string>();
    for (const s of supplierFixtures) {
      expect(SupplierSchema.safeParse(s).success, s.id).toBe(true);
      expect(s.name.startsWith("Тест")).toBe(true);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      for (const src of s.sources) expect(new URL(src.url).hostname).toMatch(/example\.(ru|com|org|net)$/);
    }
  });

  it("покрывают пустые поля, частичные данные и разные регионы", () => {
    expect(supplierFixtures.some((s) => s.minOrder.value === null)).toBe(true);
    expect(supplierFixtures.some((s) => s.certificates.value === null)).toBe(true);
    expect(supplierFixtures.some((s) => s.website.value === null)).toBe(true);
    expect(supplierFixtures.some((s) => s.contacts.phones.length === 0)).toBe(true);
    const regions = new Set(supplierFixtures.flatMap((s) => s.workRegions.value ?? []));
    expect(regions.size).toBeGreaterThanOrEqual(5);
    for (const id of regions) {
      if (id !== "Тульская область") expect(REGIONS.some((r) => r.id === id), id).toBe(true);
    }
  });

  it("сводка по фикстурам", () => {
    const rows = supplierFixtures.map((s) => {
      const r = SupplierSchema.safeParse(s);
      return `${r.success ? "OK " : "ERR"} ${s.id.padEnd(22)} sources=${s.sources.length} ` +
        `МОЗ=${s.minOrder.value ? "да" : "нет"} цена=${s.priceHint.value ? "да" : "нет"} ` +
        `сертиф=${s.certificates.value?.length ?? 0}`;
    });
    console.log("\n" + rows.join("\n"));
    expect(rows.every((r) => r.startsWith("OK"))).toBe(true);
  });
});

describe("Supplier: провенанс и строгость", () => {
  it("INVARIANT: значение без источника в любом поле не проходит (website)", () => {
    const s = clone(fullSupplier);
    s.website = { value: "https://mukomol.example.ru", sourceUrl: null, confidence: "high" };
    const r = SupplierSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.message.includes("без источника"))).toBe(true);
  });

  it("INVARIANT: значение без источника во вложенном поле контактов не проходит", () => {
    const s = clone(fullSupplier);
    s.contacts.phones = [{ value: "+7 000", sourceUrl: null, confidence: "medium" }];
    const r = SupplierSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path.slice(0, 3)).toEqual(["contacts", "phones", 0]);
  });

  it("sourceUrl поля обязан быть среди sources", () => {
    const s = clone(minimalSupplier);
    s.description = field("текст", "https://elsewhere.example.ru/page");
    const r = SupplierSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain("sources");
  });

  it("неизвестная категория отклоняется", () => {
    const s = clone(minimalSupplier);
    s.categories = ["wizardry"];
    expect(SupplierSchema.safeParse(s).success).toBe(false);
  });

  it("пустой список категорий и лишние ключи отклоняются", () => {
    expect(SupplierSchema.safeParse({ ...clone(minimalSupplier), categories: [] }).success).toBe(false);
    expect(SupplierSchema.safeParse({ ...clone(minimalSupplier), rating: 5 }).success).toBe(false);
  });

  it("цена: min > max отклоняется", () => {
    const s = clone(fullSupplier);
    s.priceHint = field({ min: 100, max: 10, currency: "RUB", unit: "кг", rawText: "x" }, "https://mukomol.example.ru/price");
    expect(SupplierSchema.safeParse(s).success).toBe(false);
  });

  it("сертификат: неизвестный тип и битая ссылка отклоняются", () => {
    const bad = (cert: unknown) => {
      const s = clone(fullSupplier) as unknown as Record<string, unknown>;
      s.certificates = field([cert], "https://mukomol.example.ru/docs");
      return SupplierSchema.safeParse(s).success;
    };
    expect(bad({ type: "fda", title: null, documentUrl: null })).toBe(false);
    expect(bad({ type: "gost", title: null, documentUrl: "не ссылка" })).toBe(false);
    expect(bad({ type: "gost", title: null, documentUrl: null })).toBe(true);
  });

  it("невалидный email и дата сбора отклоняются", () => {
    const s = clone(fullSupplier);
    s.contacts.emails = [field("не-почта", "https://mukomol.example.ru/contacts")];
    expect(SupplierSchema.safeParse(s).success).toBe(false);
    expect(SupplierSchema.safeParse({ ...clone(fullSupplier), collectedAt: "вчера" }).success).toBe(false);
  });

  it("пустое поле допускается везде", () => {
    const s = clone(minimalSupplier);
    s.minOrder = emptyField();
    expect(SupplierSchema.safeParse(s).success).toBe(true);
  });
});
