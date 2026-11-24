import { CATEGORIES, REGIONS } from "@/domain";

/** Справочник категорий текстом для промпта. */
export const CATEGORY_LIST_TEXT = CATEGORIES.map(
  (c) => `${c.id} — ${c.label}\n${c.subcategories.map((s) => `  ${s.id} — ${s.label}`).join("\n")}`,
).join("\n");

/** Справочник мест текстом для промпта. */
export const PLACE_LIST_TEXT = REGIONS.map(
  (r) => `${r.id} — ${r.name}${r.cities.length ? `; города: ${r.cities.map((c) => `${c.id} — ${c.name}`).join(", ")}` : ""}`,
).join("\n");

export const REGION_IDS = REGIONS.map((r) => r.id) as [string, ...string[]];
export const CITY_IDS = REGIONS.flatMap((r) => r.cities.map((c) => c.id)) as [string, ...string[]];
export const TOP_CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];
export const SUBCATEGORY_IDS = CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.id)) as [string, ...string[]];
