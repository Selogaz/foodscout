import { findCity, findRegion, type Location, yandexLrForLocation } from "@/domain";

/**
 * Код lr для поиска по месту из формы. Порядок: код города → код региона →
 * код столицы региона (первый город справочника) → null (поиск без фильтра).
 */
export function searchLrForLocation(loc: Location): number | null {
  const direct = yandexLrForLocation(loc);
  if (direct != null) return direct;
  const region = findRegion(loc.regionId);
  return region?.cities.find((c) => c.yandexLr != null)?.yandexLr ?? null;
}

/** Человекочитаемое место для поисковой фразы («Казань», «Свердловская область»). */
export function locationLabel(loc: Location): string {
  if (loc.cityId) {
    const hit = findCity(loc.cityId);
    if (hit) return hit.city.name;
  }
  return findRegion(loc.regionId)?.name ?? loc.regionId;
}
