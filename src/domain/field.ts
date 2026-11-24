import { z } from "zod";

/** Насколько можно доверять извлечённому значению. */
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export type SourcedField<T> = {
  /** Само значение; null — «нет данных». */
  value: T | null;
  /** URL страницы, на которой значение найдено. */
  sourceUrl: string | null;
  /** Уверенность извлечения. */
  confidence: Confidence | null;
  /** Пояснение (например, «цена указана для оптовых партий»). */
  note?: string;
};

/**
 * Поле с происхождением. Инварианты (правило «нельзя выдумывать данные»):
 * значение без источника недопустимо, значение без уровня уверенности — тоже.
 */
export function sourcedField<T>(
  valueSchema: z.ZodType<T>,
): z.ZodType<SourcedField<T>> {
  return z
    .strictObject({
      value: valueSchema.nullable() as z.ZodType<T | null>,
      sourceUrl: z.url({ protocol: /^https?$/ }).nullable(),
      confidence: ConfidenceSchema.nullable(),
      note: z.string().min(1).optional(),
    })
    .superRefine((field, ctx) => {
      if (field.value !== null && field.sourceUrl === null) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "Значение без источника: у заполненного поля должен быть sourceUrl",
        });
      }
      if (field.value !== null && field.confidence === null) {
        ctx.addIssue({
          code: "custom",
          path: ["confidence"],
          message: "У заполненного поля должен быть указан уровень уверенности",
        });
      }
    });
}

/** Поле «нет данных». */
export function emptyField<T = never>(note?: string): SourcedField<T> {
  return { value: null, sourceUrl: null, confidence: null, ...(note ? { note } : {}) };
}

/** Заполненное поле с источником. */
export function field<T>(
  value: T,
  sourceUrl: string,
  confidence: Confidence = "high",
  note?: string,
): SourcedField<T> {
  return { value, sourceUrl, confidence, ...(note ? { note } : {}) };
}
