import { describe, expect, it } from "vitest";
import { CATEGORIES, REGIONS, allCategoryIds, findCity, placeName } from "./catalog";

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

  it("показывает название города и региона, сохраняет свободный текст", () => {
    expect(placeName("krasnodar")).toBe("Краснодар");
    expect(placeName("moscow-oblast")).toBe("Московская область");
    expect(placeName("Тульская область")).toBe("Тульская область");
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

  it("у каждого города и региона есть предложный падеж с предлогом", () => {
    for (const r of REGIONS) {
      expect(r.locative).toMatch(/^во? [А-ЯЁ]/);
      for (const c of r.cities) expect(c.locative).toMatch(/^во? [А-ЯЁ]/);
    }
    expect(findCity("moscow")?.city.locative).toBe("в Москве");
    expect(findCity("vladivostok")?.city.locative).toBe("во Владивостоке");
    expect(REGIONS.find((r) => r.id === "tatarstan")?.locative).toBe("в Республике Татарстан");
  });

  it("у каждого города и региона есть винительный падеж (направление) с предлогом", () => {
    for (const r of REGIONS) {
      expect(r.accusative).toMatch(/^во? [А-ЯЁ]/);
      for (const c of r.cities) expect(c.accusative).toMatch(/^во? [А-ЯЁ]/);
    }
    expect(findCity("moscow")?.city.accusative).toBe("в Москву");
    expect(findCity("vladivostok")?.city.accusative).toBe("во Владивосток");
    expect(findCity("kazan")?.city.accusative).toBe("в Казань");
    expect(REGIONS.find((r) => r.id === "tatarstan")?.accusative).toBe("в Республику Татарстан");
    expect(REGIONS.find((r) => r.id === "krasnodar-krai")?.accusative).toBe("в Краснодарский край");
  });
});
