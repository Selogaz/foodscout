import {
  CATEGORIES,
  CERTIFICATE_TYPES,
  normalizeLocation,
  SearchQuerySchema,
  findCity,
  findRegion,
  REGIONS,
  type CertificateType,
  type SearchQuery,
} from "@/domain";
import { DEMO_EXAMPLES } from "@/data/demo/examples";

/** Состояние формы поиска. Всё, что здесь лежит, переживает перезагрузку через URL. */
export type FormState = {
  /** Текст в поле «Категория»: название из справочника либо свободный ввод. */
  category: string;
  product: string;
  /** Текст в поле «Город или регион». */
  location: string;
  certificates: CertificateType[];
  /** Максимальный МОЗ: число строкой (поле ввода) и единица. */
  maxMoq: string;
  moqUnit: string;
  needDelivery: boolean;
  priceImportance: "low" | "medium" | "high";
};

export const MOQ_UNITS = ["кг", "т", "шт", "л"] as const;

export const EMPTY_FORM: FormState = {
  category: "",
  product: "",
  location: "",
  certificates: [],
  maxMoq: "",
  moqUnit: "кг",
  needDelivery: false,
  priceImportance: "medium",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

export type CategoryOption = { id: string; label: string; hint?: string; categoryId: string; subcategoryId?: string };

/** Плоский список категорий и подкатегорий справочника для комбобокса. */
export const CATEGORY_OPTIONS: CategoryOption[] = CATEGORIES.flatMap((c) => [
  { id: c.id, label: c.label, categoryId: c.id },
  ...c.subcategories.map((s) => ({ id: `${c.id}/${s.id}`, label: s.label, hint: c.label, categoryId: c.id, subcategoryId: s.id })),
]);

export type LocationOption = { id: string; label: string; hint?: string };

/** Города и регионы: «Москва» не дублируется регионом-тёзкой. */
export const LOCATION_OPTIONS: LocationOption[] = REGIONS.flatMap((r) => {
  const sameName = r.cities.some((c) => norm(c.name) === norm(r.name));
  const regionOpt: LocationOption[] = sameName ? [] : [{ id: r.id, label: r.name, hint: "регион" }];
  const cityOpts = r.cities.map((c) => ({ id: c.id, label: c.name, hint: norm(c.name) === norm(r.name) ? undefined : r.name }));
  return [...regionOpt, ...cityOpts];
});

export function findCategoryOptionByText(text: string): CategoryOption | undefined {
  const n = norm(text);
  return n ? CATEGORY_OPTIONS.find((o) => norm(o.label) === n) : undefined;
}

export type BuildResult = { ok: true; query: SearchQuery } | { ok: false; errors: { category?: string; location?: string; maxMoq?: string } };

/** Превращает состояние формы в запрос API. Ошибки — по-русски, привязаны к полям. */
export function buildQuery(form: FormState): BuildResult {
  const errors: { category?: string; location?: string; maxMoq?: string } = {};
  const catText = form.category.trim();
  const catOpt = findCategoryOptionByText(catText);
  if (catText.length < 2) errors.category = "Укажите категорию: выберите из списка или введите свою (от 2 символов).";
  const location = form.location.trim() ? normalizeLocation(form.location) : null;
  if (!location) errors.location = form.location.trim() ? "Не нашли такой город или регион. Выберите из списка." : "Укажите город или регион.";
  let maxMinOrder: { value: number; unit: string } | null = null;
  if (form.maxMoq.trim()) {
    const v = Number(form.maxMoq.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) errors.maxMoq = "Введите положительное число.";
    else maxMinOrder = { value: v, unit: form.moqUnit };
  }
  if (errors.category || errors.location || errors.maxMoq || !location) return { ok: false, errors };

  const parsed = SearchQuerySchema.parse({
    category: catOpt
      ? { kind: "catalog", categoryId: catOpt.categoryId, ...(catOpt.subcategoryId ? { subcategoryId: catOpt.subcategoryId } : {}) }
      : { kind: "free", text: catText },
    product: form.product.trim(),
    location,
    needCertificates: form.certificates,
    maxMinOrder,
    needDelivery: form.needDelivery,
    priceImportance: form.priceImportance,
  });
  return { ok: true, query: parsed };
}

// ---------- URL ----------

/** Короткие ключи: c — категория справочника (`cat` или `cat/sub`), ct — свободный текст, p — товар,
 *  l — город/регион (id), cert — сертификаты, moq/u — МОЗ, d — доставка, pi — важность цены. */
export function formToParams(form: FormState): URLSearchParams {
  const p = new URLSearchParams();
  const catOpt = findCategoryOptionByText(form.category);
  if (catOpt) p.set("c", catOpt.id);
  else if (form.category.trim()) p.set("ct", form.category.trim());
  if (form.product.trim()) p.set("p", form.product.trim());
  const loc = form.location.trim() ? normalizeLocation(form.location) : null;
  if (loc) p.set("l", loc.cityId ?? loc.regionId);
  else if (form.location.trim()) p.set("lt", form.location.trim());
  if (form.certificates.length) p.set("cert", form.certificates.join(","));
  if (form.maxMoq.trim()) {
    p.set("moq", form.maxMoq.trim());
    p.set("u", form.moqUnit);
  }
  if (form.needDelivery) p.set("d", "1");
  if (form.priceImportance !== "medium") p.set("pi", form.priceImportance);
  return p;
}

export function paramsToForm(params: URLSearchParams): FormState {
  const form: FormState = { ...EMPTY_FORM };
  const c = params.get("c");
  const ct = params.get("ct");
  if (c) form.category = CATEGORY_OPTIONS.find((o) => o.id === c)?.label ?? "";
  else if (ct) form.category = ct.slice(0, 200);
  form.product = (params.get("p") ?? "").slice(0, 200);
  const l = params.get("l");
  if (l) {
    const city = findCity(l);
    form.location = city ? city.city.name : (findRegion(l)?.name ?? "");
  } else form.location = (params.get("lt") ?? "").slice(0, 100);
  form.certificates = (params.get("cert") ?? "")
    .split(",")
    .filter((x): x is CertificateType => (CERTIFICATE_TYPES as readonly string[]).includes(x));
  const moq = params.get("moq");
  if (moq && Number(moq) > 0) form.maxMoq = moq;
  const u = params.get("u");
  if (u && (MOQ_UNITS as readonly string[]).includes(u)) form.moqUnit = u;
  form.needDelivery = params.get("d") === "1";
  const pi = params.get("pi");
  if (pi === "low" || pi === "high") form.priceImportance = pi;
  return form;
}

/** Есть ли в URL что-то из формы (чтобы понять, что ссылку прислали с запросом). */
export function hasFormParams(params: URLSearchParams): boolean {
  return ["c", "ct", "p", "l", "lt"].some((k) => params.has(k));
}

// ---------- примеры ----------

export type ExampleQuery = { label: string; form: FormState };

/** Чипы-примеры = записанные демо-запросы (src/data/demo/examples.ts): по ним в демо-режиме есть точное совпадение. */
export const EXAMPLES: ExampleQuery[] = DEMO_EXAMPLES.map((ex) => ({
  label: ex.label,
  form: { ...EMPTY_FORM, category: ex.category, product: ex.product, location: ex.location },
}));
