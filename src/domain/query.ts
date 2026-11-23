import { z } from "zod";
import { findCategory, findCity, findRegion, REGIONS } from "./catalog";

export const CERTIFICATE_TYPES = [
  "gost", "tu", "eaeu-declaration", "haccp", "iso", "halal", "organic", "other",
] as const;
export const CertificateTypeSchema = z.enum(CERTIFICATE_TYPES);
export type CertificateType = z.infer<typeof CertificateTypeSchema>;

export const CERTIFICATE_LABELS: Record<CertificateType, string> = {
  gost: "ГОСТ",
  tu: "ТУ",
  "eaeu-declaration": "Декларация ЕАЭС",
  haccp: "ХАССП",
  iso: "ISO",
  halal: "Халяль",
  organic: "Органик",
  other: "Иное",
};

/** Категория: из справочника либо свободный текст. */
export const CategoryRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("catalog"),
    categoryId: z.string(),
    subcategoryId: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("free"), text: z.string().trim().min(2).max(200) }),
]);

export const LocationSchema = z.strictObject({
  regionId: z.string(),
  cityId: z.string().nullable(),
});
export type Location = z.infer<typeof LocationSchema>;

export const PriceImportanceSchema = z.enum(["low", "medium", "high"]);

export const SearchQuerySchema = z
  .strictObject({
    category: CategoryRefSchema,
    /** Конкретный товар свободным текстом, например «гречневая крупа ядрица». */
    product: z.string().trim().max(200).default(""),
    location: LocationSchema,
    needCertificates: z.array(CertificateTypeSchema).default([]),
    maxMinOrder: z
      .strictObject({ value: z.number().positive(), unit: z.string().trim().min(1) })
      .nullable()
      .default(null),
    needDelivery: z.boolean().default(false),
    priceImportance: PriceImportanceSchema.default("medium"),
  })
  .superRefine((q, ctx) => {
    if (q.category.kind === "catalog") {
      const { categoryId, subcategoryId } = q.category;
      const cat = findCategory(categoryId);
      if (!cat) {
        ctx.addIssue({ code: "custom", path: ["category", "categoryId"], message: "Неизвестная категория" });
      } else if (
        subcategoryId &&
        !cat.subcategories.some((s) => s.id === subcategoryId)
      ) {
        ctx.addIssue({ code: "custom", path: ["category", "subcategoryId"], message: "Подкатегория не принадлежит категории" });
      }
    }
    const region = findRegion(q.location.regionId);
    if (!region) {
      ctx.addIssue({ code: "custom", path: ["location", "regionId"], message: "Неизвестный регион" });
    } else if (q.location.cityId && !region.cities.some((c) => c.id === q.location.cityId)) {
      ctx.addIssue({ code: "custom", path: ["location", "cityId"], message: "Город не принадлежит региону" });
    }
  });
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchQueryInput = z.input<typeof SearchQuerySchema>;

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^(г\.?|город)\s+/, "")
    .replace(/[\s_]+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

/**
 * Нормализация введённого текста (город или регион) в Location.
 * Возвращает null, если ничего не найдено — вызывающий код показывает понятную ошибку.
 */
export function normalizeLocation(text: string): Location | null {
  const needle = norm(text);
  if (!needle) return null;
  for (const region of REGIONS) {
    for (const c of region.cities) {
      if ([c.name, c.id, ...c.aliases].some((n) => norm(n) === needle)) {
        return { regionId: region.id, cityId: c.id };
      }
    }
  }
  for (const region of REGIONS) {
    if ([region.name, region.id, ...region.aliases].some((n) => norm(n) === needle)) {
      return { regionId: region.id, cityId: null };
    }
  }
  return null;
}

/** Код региона Яндекса для поиска: город точнее региона; null — без фильтра по региону. */
export function yandexLrForLocation(loc: Location): number | null {
  if (loc.cityId) {
    const hit = findCity(loc.cityId);
    if (hit?.city.yandexLr != null) return hit.city.yandexLr;
  }
  return findRegion(loc.regionId)?.yandexLr ?? null;
}
