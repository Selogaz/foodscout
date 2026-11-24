import { findCategory, findCity, findRegion, findSubcategory, type Confidence, type SearchQuery, type Source } from "@/domain";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Регионы бывают id справочника или свободным текстом: id показываем названием. */
export function regionNames(list: readonly string[]): string {
  return list.map((r) => findRegion(r)?.name ?? r).join(", ");
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

export const SOURCE_TYPE_LABELS: Record<Source["type"], string> = {
  "official-site": "Официальный сайт",
  catalog: "Каталог",
  "search-result": "Результат поиска",
  marketplace: "Маркетплейс",
  registry: "Реестр",
  other: "Другое",
};

export const MESSENGER_LABELS: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  viber: "Viber",
  max: "MAX",
  other: "Мессенджер",
};

/** Дата сбора «20.11.2026»; при нечитаемой дате — исходная строка. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" });
}

/** Запрос человеческим языком: «мука пшеничная, Москва» (для шортлиста: «найден по запросу…»). */
export function describeQuery(q: SearchQuery): string {
  let what = q.product;
  if (!what) {
    if (q.category.kind === "free") what = q.category.text;
    else {
      const sub = q.category.subcategoryId ? findSubcategory(q.category.categoryId, q.category.subcategoryId) : undefined;
      what = sub?.label ?? findCategory(q.category.categoryId)?.label ?? q.category.categoryId;
    }
  }
  const region = findRegion(q.location.regionId);
  const city = q.location.cityId ? findCity(q.location.cityId)?.city : undefined;
  const place = city?.name ?? region?.name ?? q.location.regionId;
  return `${what}, ${place}`;
}
