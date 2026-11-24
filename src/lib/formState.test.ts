import { describe, expect, it } from "vitest";
import { buildQuery, EMPTY_FORM, EXAMPLES, formToParams, paramsToForm, type FormState } from "./formState";

describe("buildQuery", () => {
  it("превращает пример в валидный запрос API", () => {
    for (const ex of EXAMPLES) {
      const r = buildQuery(ex.form);
      expect(r.ok, ex.label).toBe(true);
    }
  });

  it("категория из справочника → catalog, иначе free", () => {
    const a = buildQuery({ ...EMPTY_FORM, category: "Мука, крупы, злаки", location: "Москва" });
    expect(a.ok && a.query.category).toEqual({ kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" });
    const b = buildQuery({ ...EMPTY_FORM, category: "кофе в зёрнах", location: "казань" });
    expect(b.ok && b.query.category).toEqual({ kind: "free", text: "кофе в зёрнах" });
    expect(b.ok && b.query.location).toEqual({ regionId: "tatarstan", cityId: "kazan" });
  });

  it("возвращает ошибки по полям", () => {
    const r = buildQuery({ ...EMPTY_FORM, category: "", location: "Нигде", maxMoq: "-3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.category).toBeTruthy();
      expect(r.errors.location).toContain("Выберите из списка");
      expect(r.errors.maxMoq).toBeTruthy();
    }
  });

  it("МОЗ и фильтры попадают в запрос", () => {
    const r = buildQuery({ ...EMPTY_FORM, category: "Упаковка", location: "Омск", maxMoq: "500,5", moqUnit: "кг", certificates: ["gost", "iso"], needDelivery: true });
    expect(r.ok && r.query.maxMinOrder).toEqual({ value: 500.5, unit: "кг" });
    expect(r.ok && r.query.needCertificates).toEqual(["gost", "iso"]);
    expect(r.ok && r.query.needDelivery).toBe(true);
  });
});

describe("состояние формы в URL", () => {
  it("туда и обратно без потерь", () => {
    const form: FormState = {
      category: "Мясо, рыба, птица",
      product: "курица",
      location: "Казань",
      certificates: ["gost", "haccp"],
      maxMoq: "100",
      moqUnit: "т",
      needDelivery: true,
      priceImportance: "high",
    };
    const params = formToParams(form);
    expect(params.get("c")).toBe("ingredients/meat-fish");
    expect(params.get("l")).toBe("kazan");
    expect(paramsToForm(new URLSearchParams(params.toString()))).toEqual(form);
  });

  it("свободная категория и мусор в параметрах", () => {
    const p = formToParams({ ...EMPTY_FORM, category: "упаковка для кофе", location: "Краснодарский край" });
    expect(p.get("ct")).toBe("упаковка для кофе");
    expect(p.get("l")).toBe("krasnodar-krai");
    const bad = paramsToForm(new URLSearchParams("c=nope&l=zzz&cert=gost,evil&moq=abc&u=km&pi=x"));
    expect(bad).toEqual({ ...EMPTY_FORM, certificates: ["gost"] });
  });
});
