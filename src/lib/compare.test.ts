import { describe, expect, it } from "vitest";
import { rankSuppliers, type SearchQuery } from "@/domain";
import { fullSupplier, minimalSupplier, rawTextSupplier } from "@/domain/__fixtures__/suppliers";
import { bestIndexes, commonOrNull, moqNumbers, priceNumbers } from "./compare";

const query: SearchQuery = {
  category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
  product: "мука",
  location: { regionId: "moscow", cityId: "moscow" },
  needCertificates: [],
  maxMinOrder: null,
  needDelivery: false,
  priceImportance: "medium",
};

describe("bestIndexes", () => {
  it("находит максимум и минимум, пропуски не участвуют", () => {
    expect([...bestIndexes([5, null, 9, 3], "max")]).toEqual([2]);
    expect([...bestIndexes([5, null, 9, 3], "min")]).toEqual([3]);
  });
  it("ничья подсвечивает всех лучших", () => {
    expect([...bestIndexes([9, 9, 3], "max")]).toEqual([0, 1]);
  });
  it("нечего сравнивать — ничего не подсвечиваем", () => {
    expect(bestIndexes([4, null, null], "max").size).toBe(0);
    expect(bestIndexes([4, 4], "max").size).toBe(0);
    expect(bestIndexes([null, null], "min").size).toBe(0);
  });
});

describe("commonOrNull", () => {
  it("общее значение или null", () => {
    expect(commonOrNull(["кг", null, "кг"])).toBe("кг");
    expect(commonOrNull(["кг", "т"])).toBeNull();
    expect(commonOrNull([null])).toBeNull();
  });
});

describe("числа для сравнения", () => {
  const items = rankSuppliers([fullSupplier, minimalSupplier, rawTextSupplier], query);
  it("МОЗ и цена без чисел или без второго значения не сравниваются", () => {
    expect(moqNumbers(items).every((x) => x === null)).toBe(true);
    expect(priceNumbers(items).every((x) => x === null)).toBe(true);
  });
  it("сравниваются при одинаковых единицах", () => {
    const a = { ...fullSupplier, id: "a" };
    const b = { ...fullSupplier, id: "b", minOrder: { ...fullSupplier.minOrder, value: { quantity: 200, unit: "кг", rawText: "от 200 кг" } } };
    const r = rankSuppliers([a, b], query);
    const byId = Object.fromEntries(r.map((x, i) => [x.supplier.id, moqNumbers(r)[i]]));
    expect(byId).toEqual({ a: 500, b: 200 });
  });
});
