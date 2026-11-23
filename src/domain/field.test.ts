import { describe, expect, it } from "vitest";
import { z } from "zod";
import { emptyField, field, sourcedField } from "./field";

const schema = sourcedField(z.string());

describe("SourcedField: происхождение значения", () => {
  it("INVARIANT: значение без источника не проходит", () => {
    const r = schema.safeParse({ value: "+7 000", sourceUrl: null, confidence: "high" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain("без источника");
    expect(r.error?.issues[0].path).toEqual(["sourceUrl"]);
  });

  it("значение без уверенности не проходит", () => {
    const r = schema.safeParse({ value: "x", sourceUrl: "https://a.example.ru", confidence: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["confidence"]);
  });

  it("пустое поле «нет данных» проходит", () => {
    expect(schema.safeParse(emptyField()).success).toBe(true);
  });

  it("заполненное поле с источником проходит", () => {
    expect(schema.safeParse(field("x", "https://a.example.ru", "low", "заметка")).success).toBe(true);
  });

  it("не принимает лишние ключи, неверный URL и неверную уверенность", () => {
    expect(schema.safeParse({ ...emptyField(), extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ value: "x", sourceUrl: "не-url", confidence: "high" }).success).toBe(false);
    expect(schema.safeParse({ value: "x", sourceUrl: "https://a.example.ru", confidence: "certain" }).success).toBe(false);
  });

  it("null со ссылкой допустим: страницу смотрели, данных не нашли", () => {
    expect(schema.safeParse({ value: null, sourceUrl: "https://a.example.ru", confidence: null }).success).toBe(true);
  });
});
