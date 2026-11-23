/**
 * Справочники категорий и регионов.
 * `yandexLr` — код региона Яндекса для параметра `lr` поиска. Источник кодов городов —
 * справочник регионов Yandex Search API; код, который не удалось подтвердить, равен null.
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
  /** Предложный падеж с предлогом («в Москве», «во Владивостоке»): для фраз «Доставка в …». */
  locative: string;
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
  aliases: readonly string[];
  yandexLr: number | null;
  cities: readonly CatalogCity[];
};

const city = (
  id: string,
  name: string,
  locative: string,
  yandexLr: number | null,
  millionPlus: boolean,
  aliases: string[] = [],
): CatalogCity => ({ id, name, locative, yandexLr, millionPlus, aliases });

export const REGIONS: readonly CatalogRegion[] = [
  { id: "moscow", name: "Москва", locative: "в Москве", aliases: ["мск", "г. москва"], yandexLr: 213,
    cities: [city("moscow", "Москва", "в Москве", 213, true, ["мск"])] },
  // lr=1 в справочнике Яндекса — «Москва и Московская область»
  { id: "moscow-oblast", name: "Московская область", locative: "в Московской области", aliases: ["подмосковье", "мо"], yandexLr: 1, cities: [] },
  { id: "saint-petersburg", name: "Санкт-Петербург", locative: "в Санкт-Петербурге", aliases: ["спб", "питер", "санкт петербург"], yandexLr: 2,
    cities: [city("saint-petersburg", "Санкт-Петербург", "в Санкт-Петербурге", 2, true, ["спб", "питер", "санкт петербург"])] },
  { id: "leningrad-oblast", name: "Ленинградская область", locative: "в Ленинградской области", aliases: ["ло"], yandexLr: null, cities: [] },
  { id: "novosibirsk-oblast", name: "Новосибирская область", locative: "в Новосибирской области", aliases: [], yandexLr: null,
    cities: [city("novosibirsk", "Новосибирск", "в Новосибирске", 65, true)] },
  { id: "sverdlovsk-oblast", name: "Свердловская область", locative: "в Свердловской области", aliases: [], yandexLr: null,
    cities: [city("yekaterinburg", "Екатеринбург", "в Екатеринбурге", 54, true, ["екб"])] },
  { id: "tatarstan", name: "Республика Татарстан", locative: "в Республике Татарстан", aliases: ["татарстан"], yandexLr: null,
    cities: [city("kazan", "Казань", "в Казани", 43, true)] },
  { id: "nizhny-novgorod-oblast", name: "Нижегородская область", locative: "в Нижегородской области", aliases: [], yandexLr: null,
    cities: [city("nizhny-novgorod", "Нижний Новгород", "в Нижнем Новгороде", 47, true, ["нижний"])] },
  { id: "chelyabinsk-oblast", name: "Челябинская область", locative: "в Челябинской области", aliases: [], yandexLr: null,
    cities: [city("chelyabinsk", "Челябинск", "в Челябинске", 56, true)] },
  { id: "samara-oblast", name: "Самарская область", locative: "в Самарской области", aliases: [], yandexLr: null,
    cities: [city("samara", "Самара", "в Самаре", 51, true)] },
  { id: "omsk-oblast", name: "Омская область", locative: "в Омской области", aliases: [], yandexLr: null,
    cities: [city("omsk", "Омск", "в Омске", 66, true)] },
  { id: "rostov-oblast", name: "Ростовская область", locative: "в Ростовской области", aliases: [], yandexLr: null,
    cities: [city("rostov-on-don", "Ростов-на-Дону", "в Ростове-на-Дону", 39, true, ["ростов"])] },
  { id: "bashkortostan", name: "Республика Башкортостан", locative: "в Республике Башкортостан", aliases: ["башкирия"], yandexLr: null,
    cities: [city("ufa", "Уфа", "в Уфе", 172, true)] },
  { id: "krasnoyarsk-krai", name: "Красноярский край", locative: "в Красноярском крае", aliases: [], yandexLr: null,
    cities: [city("krasnoyarsk", "Красноярск", "в Красноярске", 62, true)] },
  { id: "voronezh-oblast", name: "Воронежская область", locative: "в Воронежской области", aliases: [], yandexLr: null,
    cities: [city("voronezh", "Воронеж", "в Воронеже", 193, true)] },
  { id: "perm-krai", name: "Пермский край", locative: "в Пермском крае", aliases: [], yandexLr: null,
    cities: [city("perm", "Пермь", "в Перми", 50, true)] },
  { id: "volgograd-oblast", name: "Волгоградская область", locative: "в Волгоградской области", aliases: [], yandexLr: null,
    cities: [city("volgograd", "Волгоград", "в Волгограде", 38, true)] },
  { id: "krasnodar-krai", name: "Краснодарский край", locative: "в Краснодарском крае", aliases: ["кубань"], yandexLr: null,
    cities: [city("krasnodar", "Краснодар", "в Краснодаре", 35, true), city("sochi", "Сочи", "в Сочи", 239, false)] },
  { id: "altai-krai", name: "Алтайский край", locative: "в Алтайском крае", aliases: ["алтай"], yandexLr: null,
    cities: [city("barnaul", "Барнаул", "в Барнауле", 197, false)] },
  { id: "primorsky-krai", name: "Приморский край", locative: "в Приморском крае", aliases: ["приморье"], yandexLr: null,
    cities: [city("vladivostok", "Владивосток", "во Владивостоке", 75, false)] },
  { id: "khabarovsk-krai", name: "Хабаровский край", locative: "в Хабаровском крае", aliases: [], yandexLr: null,
    cities: [city("khabarovsk", "Хабаровск", "в Хабаровске", 76, false)] },
  { id: "irkutsk-oblast", name: "Иркутская область", locative: "в Иркутской области", aliases: [], yandexLr: null,
    cities: [city("irkutsk", "Иркутск", "в Иркутске", 63, false)] },
  { id: "kaliningrad-oblast", name: "Калининградская область", locative: "в Калининградской области", aliases: [], yandexLr: null,
    cities: [city("kaliningrad", "Калининград", "в Калининграде", 22, false)] },
  { id: "stavropol-krai", name: "Ставропольский край", locative: "в Ставропольском крае", aliases: [], yandexLr: null,
    cities: [city("stavropol", "Ставрополь", "в Ставрополе", 36, false)] },
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

/** Все id категорий и подкатегорий (для проверки Supplier.categories). */
export function allCategoryIds(): string[] {
  return CATEGORIES.flatMap((c) => [c.id, ...c.subcategories.map((s) => s.id)]);
}
