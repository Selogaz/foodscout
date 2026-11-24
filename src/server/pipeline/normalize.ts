import { z } from "zod";
import {
  findCategory,
  findCity,
  findRegion,
  findSubcategory,
  type Location,
  normalizeLocation,
  SearchQuerySchema,
} from "@/domain";
import type { LlmProvider } from "../llm/types";
import { locationLabel, searchLrForLocation } from "../search/region";
import { CATEGORY_LIST_TEXT, CITY_IDS, PLACE_LIST_TEXT, REGION_IDS, SUBCATEGORY_IDS, TOP_CATEGORY_IDS } from "./catalog-text";
import { buildNormalizeUserPrompt, NORMALIZE_SYSTEM_PROMPT } from "./prompts/normalize";
import { type NormalizedQuery, PipelineInputError, type SearchInput } from "./types";

export const NormalizeLlmSchema = z.object({
  searchTerms: z.array(z.string().trim().min(2).max(80)).min(1).max(3),
  categoryId: z.enum(TOP_CATEGORY_IDS).nullable(),
  subcategoryId: z.enum(SUBCATEGORY_IDS).nullable(),
  regionId: z.enum(REGION_IDS).nullable(),
  cityId: z.enum(CITY_IDS).nullable(),
});
export type NormalizeLlmAnswer = z.infer<typeof NormalizeLlmSchema>;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Формулировки для поиска: главный товар и синоним × «оптом/производитель/поставщик» + место. */
export function buildSearchPhrases(terms: string[], place: string, max: number): string[] {
  const [main, ...rest] = terms.map(clean).filter(Boolean);
  if (!main) return [];
  const phrases = [
    `${main} оптом ${place}`,
    `${main} производитель ${place}`,
    ...rest.map((t) => `${t} оптом ${place}`),
    `${main} поставщик ${place}`,
  ];
  return [...new Set(phrases.map((p) => clean(p).toLowerCase()))].slice(0, max);
}

/**
 * Нормализация запроса: место — в регион/город справочника (сначала словарём, потом LLM),
 * товар — в поисковые формулировки (LLM, при сбое — детерминированный фолбэк).
 */
export async function normalizeQuery(
  input: SearchInput,
  llm: LlmProvider,
  opts: { maxPhrases?: number; signal?: AbortSignal } = {},
): Promise<NormalizedQuery> {
  const notes: string[] = [];
  const locationText = typeof input.location === "string" ? clean(input.location) : null;
  let location: Location | null = typeof input.location === "string" ? normalizeLocation(input.location) : input.location;
  if (locationText && location) notes.push(`Место «${locationText}» понято как ${locationLabel(location)}`);

  const categoryText =
    input.category.kind === "catalog"
      ? [findCategory(input.category.categoryId)?.label, input.category.subcategoryId && findSubcategory(input.category.categoryId, input.category.subcategoryId)?.label]
          .filter(Boolean)
          .join(" / ") || input.category.categoryId
      : input.category.text;
  const product = clean(input.product ?? "");

  let answer: NormalizeLlmAnswer | null = null;
  try {
    const r = await llm.extractStructured({
      schemaName: "normalize_query",
      schema: NormalizeLlmSchema,
      system: NORMALIZE_SYSTEM_PROMPT,
      user: buildNormalizeUserPrompt({
        categoryText,
        product,
        locationText: location ? null : locationText,
        categoryList: CATEGORY_LIST_TEXT,
        placeList: PLACE_LIST_TEXT,
      }),
      maxTokens: 400,
      signal: opts.signal,
    });
    answer = r.data;
  } catch (e) {
    notes.push(`Уточнение запроса моделью не удалось (${(e as Error).message.slice(0, 120)}), ищем по исходным словам`);
  }

  if (!location && locationText && answer?.regionId) {
    const region = findRegion(answer.regionId);
    const city = answer.cityId ? findCity(answer.cityId) : undefined;
    if (region) {
      location = { regionId: region.id, cityId: city && city.region.id === region.id ? city.city.id : null };
      notes.push(`Место «${locationText}» сопоставлено со справочником: ${locationLabel(location)}`);
    }
  }
  if (!location) {
    throw new PipelineInputError(
      `Не удалось определить регион «${locationText ?? ""}». Выберите город или регион из списка.`,
    );
  }

  const parsed = SearchQuerySchema.safeParse({ ...input, location });
  if (!parsed.success) {
    throw new PipelineInputError(`Некорректный запрос: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const query = parsed.data;

  // Категории для карточек: из справочника запроса, иначе — как определила модель
  const categoryIds: string[] = [];
  if (query.category.kind === "catalog") {
    categoryIds.push(query.category.categoryId);
    if (query.category.subcategoryId) categoryIds.push(query.category.subcategoryId);
  } else if (answer?.categoryId) {
    categoryIds.push(answer.categoryId);
    if (answer.subcategoryId && findSubcategory(answer.categoryId, answer.subcategoryId)) categoryIds.push(answer.subcategoryId);
  }

  const fallbackTerm = product || (query.category.kind === "free" ? query.category.text : categoryText.split(" / ").pop()!);
  const terms = answer?.searchTerms?.length ? answer.searchTerms : [fallbackTerm];
  // Товар пользователя всегда идёт первым: модель может только добавить синонимы
  if (product && !terms.some((t) => clean(t).toLowerCase() === product.toLowerCase())) terms.unshift(product);
  const placeLabel = locationLabel(query.location);
  const searchPhrases = buildSearchPhrases(terms, placeLabel, opts.maxPhrases ?? 3);

  return {
    query,
    lr: searchLrForLocation(query.location),
    placeLabel,
    productPhrase: clean(terms[0]),
    categoryIds,
    searchPhrases,
    notes,
  };
}
