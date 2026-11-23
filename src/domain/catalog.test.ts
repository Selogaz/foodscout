import { describe, expect, it } from "vitest";
import { CATEGORIES, REGIONS, allCategoryIds, findCity } from "./catalog";

describe("справочники", () => {
  it("id категорий, подкатегорий, регионов и городов уникальны", () => {
    const ids = allCategoryIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
    const cities = REGIONS.flatMap((r) => r.cities.map((c) => c.id));
    expect(new Set(cities).size).toBe(cities.length);
  });

  it("у каждой категории есть подкатегории и русские названия", () => {
    for (const c of CATEGORIES) {
      expect(c.subcategories.length).toBeGreaterThan(0);
      expect(c.label).toMatch(/[А-Яа-я]/);
    }
  });

  it("города-миллионники присутствуют", () => {
    const million = REGIONS.flatMap((r) => r.cities).filter((c) => c.millionPlus);
    expect(million.length).toBeGreaterThanOrEqual(16);
  });

  it("yandexLr — положительное целое или null; коды городов уникальны", () => {
    for (const r of REGIONS) {
      for (const x of [r.yandexLr, ...r.cities.map((c) => c.yandexLr)]) {
        if (x !== null) {
          expect(Number.isInteger(x) && x > 0).toBe(true);
        }
      }
    }
    expect(findCity("novosibirsk")?.city.yandexLr).toBe(65);
    expect(findCity("moscow")?.city.yandexLr).toBe(213);
  });
});
