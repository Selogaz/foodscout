/**
 * Справочники категорий и регионов.
 * `yandexLr` — код региона Яндекса для параметра `lr` поиска (поле `region` Search API v2).
 * Источник — дерево регионов Yandex Search API (Wordstat getRegionsTree, сверено 2026-11-24);
 * код, который не удалось подтвердить, равен null (тогда поиск идёт по коду столицы региона).
 */

export type CatalogSubcategory = { id: string; label: string };
export type CatalogCategory = {
  id: string;
  label: string;
  subcategories: readonly CatalogSubcategory[];
};

const sub = (id: string, label: string): CatalogSubcategory => ({ id, label });

export const CATEGORIES: readonly CatalogCategory[] = [
  {
    id: "ingredients",
    label: "Ингредиенты и сырьё",
    subcategories: [
      sub("flour-cereals", "Мука, крупы, злаки"),
      sub("dairy", "Молочное сырьё"),
      sub("meat-fish", "Мясо, рыба, птица"),
      sub("fruit-veg", "Овощи, фрукты, ягоды"),
      sub("sugar-sweeteners", "Сахар, подсластители"),
      sub("oils-fats", "Масла и жиры"),
      sub("additives", "Пищевые добавки и ингредиенты"),
    ],
  },
  {
    id: "finished-food",
    label: "Готовая продукция",
    subcategories: [
      sub("bakery", "Хлебобулочные изделия"),
      sub("confectionery", "Кондитерские изделия"),
      sub("semi-finished", "Полуфабрикаты"),
      sub("canned", "Консервация"),
      sub("ready-meals", "Готовые блюда"),
      sub("dairy-products", "Молочная продукция"),
    ],
  },
  {
    id: "packaging",
    label: "Упаковка",
    subcategories: [
      sub("containers", "Контейнеры и банки"),
      sub("film-bags", "Плёнка и пакеты"),
      sub("paper-cardboard", "Бумага и картон"),
      sub("labels", "Этикетки и маркировка"),
      sub("disposable-tableware", "Одноразовая посуда"),
    ],
  },
  {
    id: "beverages",
    label: "Напитки",
    subcategories: [
      sub("water", "Вода"),
      sub("juices", "Соки и нектары"),
      sub("tea-coffee", "Чай и кофе"),
      sub("soft-drinks", "Безалкогольные напитки"),
      sub("syrups", "Сиропы и концентраты"),
    ],
  },
  {
    id: "frozen",
    label: "Заморозка",
    subcategories: [
      sub("frozen-veg", "Замороженные овощи и ягоды"),
      sub("frozen-meat-fish", "Замороженное мясо и рыба"),
      sub("frozen-dough", "Замороженное тесто и выпечка"),
      sub("ice-cream", "Мороженое"),
    ],
  },
  {
    id: "spices",
    label: "Специи и приправы",
    subcategories: [
      sub("spices-herbs", "Специи и пряные травы"),
      sub("sauces", "Соусы и заправки"),
      sub("salt-seasoning", "Соль и смеси приправ"),
    ],
  },
  {
    id: "other-food",
    label: "Прочее для food-сегмента",
    subcategories: [
      sub("equipment-consumables", "Расходники для производства"),
      sub("cleaning-hygiene", "Моющие и санитарные средства"),
    ],
  },
];

export type CatalogCity = {
  id: string;
  name: string;
  /** Предложный падеж с предлогом («в Москве», «во Владивостоке»): для фраз «Работает в …». */
  locative: string;
  /** Винительный падеж с предлогом — направление («в Москву», «во Владивосток»): для фраз «Доставка в …». */
  accusative: string;
  /** Названия-синонимы для нормализации ввода (в нижнем регистре). */
  aliases: readonly string[];
  yandexLr: number | null;
  millionPlus: boolean;
};
export type CatalogRegion = {
  id: string;
  name: string;
  /** Предложный падеж с предлогом («в Новосибирской области»). */
  locative: string;
  /** Винительный падеж с предлогом — направление («в Новосибирскую область»). */
  accusative: string;
  aliases: readonly string[];
  yandexLr: number | null;
  cities: readonly CatalogCity[];
};

const city = (
  id: string,
  name: string,
  locative: string,
  accusative: string,
  yandexLr: number | null,
  millionPlus: boolean,
  aliases: string[] = [],
): CatalogCity => ({ id, name, locative, accusative, yandexLr, millionPlus, aliases });

export const REGIONS: readonly CatalogRegion[] = [
  { id: "moscow", name: "Москва", locative: "в Москве", accusative: "в Москву", aliases: ["мск", "г. москва"], yandexLr: 213,
    cities: [city("moscow", "Москва", "в Москве", "в Москву", 213, true, ["мск"])] },
  // lr=1 в справочнике Яндекса — «Москва и область» (общий регион Москвы и Подмосковья)
  { id: "moscow-oblast", name: "Московская область", locative: "в Московской области", accusative: "в Московскую область", aliases: ["подмосковье", "мо"], yandexLr: 1, cities: [] },
  { id: "saint-petersburg", name: "Санкт-Петербург", locative: "в Санкт-Петербурге", accusative: "в Санкт-Петербург", aliases: ["спб", "питер", "санкт петербург"], yandexLr: 2,
    cities: [city("saint-petersburg", "Санкт-Петербург", "в Санкт-Петербурге", "в Санкт-Петербург", 2, true, ["спб", "питер", "санкт петербург"])] },
  // lr=10174 — «Санкт-Петербург и Ленинградская область»: отдельного кода у области нет
  { id: "leningrad-oblast", name: "Ленинградская область", locative: "в Ленинградской области", accusative: "в Ленинградскую область", aliases: ["ло"], yandexLr: 10174, cities: [] },
  { id: "novosibirsk-oblast", name: "Новосибирская область", locative: "в Новосибирской области", accusative: "в Новосибирскую область", aliases: [], yandexLr: 11316,
    cities: [city("novosibirsk", "Новосибирск", "в Новосибирске", "в Новосибирск", 65, true)] },
  { id: "sverdlovsk-oblast", name: "Свердловская область", locative: "в Свердловской области", accusative: "в Свердловскую область", aliases: [], yandexLr: 11162,
    cities: [city("yekaterinburg", "Екатеринбург", "в Екатеринбурге", "в Екатеринбург", 54, true, ["екб"])] },
  { id: "tatarstan", name: "Республика Татарстан", locative: "в Республике Татарстан", accusative: "в Республику Татарстан", aliases: ["татарстан"], yandexLr: 11119,
    cities: [city("kazan", "Казань", "в Казани", "в Казань", 43, true)] },
  { id: "nizhny-novgorod-oblast", name: "Нижегородская область", locative: "в Нижегородской области", accusative: "в Нижегородскую область", aliases: [], yandexLr: 11079,
    cities: [city("nizhny-novgorod", "Нижний Новгород", "в Нижнем Новгороде", "в Нижний Новгород", 47, true, ["нижний"])] },
  { id: "chelyabinsk-oblast", name: "Челябинская область", locative: "в Челябинской области", accusative: "в Челябинскую область", aliases: [], yandexLr: 11225,
    cities: [city("chelyabinsk", "Челябинск", "в Челябинске", "в Челябинск", 56, true)] },
  { id: "samara-oblast", name: "Самарская область", locative: "в Самарской области", accusative: "в Самарскую область", aliases: [], yandexLr: 11131,
    cities: [city("samara", "Самара", "в Самаре", "в Самару", 51, true)] },
  { id: "omsk-oblast", name: "Омская область", locative: "в Омской области", accusative: "в Омскую область", aliases: [], yandexLr: 11318,
    cities: [city("omsk", "Омск", "в Омске", "в Омск", 66, true)] },
  { id: "rostov-oblast", name: "Ростовская область", locative: "в Ростовской области", accusative: "в Ростовскую область", aliases: [], yandexLr: 11029,
    cities: [city("rostov-on-don", "Ростов-на-Дону", "в Ростове-на-Дону", "в Ростов-на-Дону", 39, true, ["ростов"])] },
  { id: "bashkortostan", name: "Республика Башкортостан", locative: "в Республике Башкортостан", accusative: "в Республику Башкортостан", aliases: ["башкирия"], yandexLr: 11111,
    cities: [city("ufa", "Уфа", "в Уфе", "в Уфу", 172, true)] },
  { id: "krasnoyarsk-krai", name: "Красноярский край", locative: "в Красноярском крае", accusative: "в Красноярский край", aliases: [], yandexLr: 11309,
    cities: [city("krasnoyarsk", "Красноярск", "в Красноярске", "в Красноярск", 62, true)] },
  { id: "voronezh-oblast", name: "Воронежская область", locative: "в Воронежской области", accusative: "в Воронежскую область", aliases: [], yandexLr: 10672,
    cities: [city("voronezh", "Воронеж", "в Воронеже", "в Воронеж", 193, true)] },
  { id: "perm-krai", name: "Пермский край", locative: "в Пермском крае", accusative: "в Пермский край", aliases: [], yandexLr: 11108,
    cities: [city("perm", "Пермь", "в Перми", "в Пермь", 50, true)] },
  { id: "volgograd-oblast", name: "Волгоградская область", locative: "в Волгоградской области", accusative: "в Волгоградскую область", aliases: [], yandexLr: 10950,
    cities: [city("volgograd", "Волгоград", "в Волгограде", "в Волгоград", 38, true)] },
  { id: "krasnodar-krai", name: "Краснодарский край", locative: "в Краснодарском крае", accusative: "в Краснодарский край", aliases: ["кубань"], yandexLr: 10995,
    cities: [city("krasnodar", "Краснодар", "в Краснодаре", "в Краснодар", 35, true), city("sochi", "Сочи", "в Сочи", "в Сочи", 239, false)] },
  { id: "altai-krai", name: "Алтайский край", locative: "в Алтайском крае", accusative: "в Алтайский край", aliases: ["алтай"], yandexLr: 11235,
    cities: [city("barnaul", "Барнаул", "в Барнауле", "в Барнаул", 197, false)] },
  { id: "primorsky-krai", name: "Приморский край", locative: "в Приморском крае", accusative: "в Приморский край", aliases: ["приморье"], yandexLr: 11409,
    cities: [city("vladivostok", "Владивосток", "во Владивостоке", "во Владивосток", 75, false)] },
  { id: "khabarovsk-krai", name: "Хабаровский край", locative: "в Хабаровском крае", accusative: "в Хабаровский край", aliases: [], yandexLr: 11457,
    cities: [city("khabarovsk", "Хабаровск", "в Хабаровске", "в Хабаровск", 76, false)] },
  { id: "irkutsk-oblast", name: "Иркутская область", locative: "в Иркутской области", accusative: "в Иркутскую область", aliases: [], yandexLr: 11266,
    cities: [city("irkutsk", "Иркутск", "в Иркутске", "в Иркутск", 63, false)] },
  { id: "kaliningrad-oblast", name: "Калининградская область", locative: "в Калининградской области", accusative: "в Калининградскую область", aliases: [], yandexLr: 10857,
    cities: [city("kaliningrad", "Калининград", "в Калининграде", "в Калининград", 22, false)] },
  { id: "stavropol-krai", name: "Ставропольский край", locative: "в Ставропольском крае", accusative: "в Ставропольский край", aliases: [], yandexLr: 11069,
    cities: [city("stavropol", "Ставрополь", "в Ставрополе", "в Ставрополь", 36, false)] },
];

export function findCategory(id: string): CatalogCategory | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function findSubcategory(categoryId: string, subId: string): CatalogSubcategory | undefined {
  return findCategory(categoryId)?.subcategories.find((s) => s.id === subId);
}

export function findRegion(id: string): CatalogRegion | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function findCity(id: string): { city: CatalogCity; region: CatalogRegion } | undefined {
  for (const region of REGIONS) {
    const c = region.cities.find((x) => x.id === id);
    if (c) return { city: c, region };
  }
  return undefined;
}

export function placeName(id: string): string {
  return findRegion(id)?.name ?? findCity(id)?.city.name ?? id;
}

/** Все id категорий и подкатегорий (для проверки Supplier.categories). */
export function allCategoryIds(): string[] {
  return CATEGORIES.flatMap((c) => [c.id, ...c.subcategories.map((s) => s.id)]);
}
