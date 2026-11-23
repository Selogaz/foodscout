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
  /** Названия-синонимы для нормализации ввода (в нижнем регистре). */
  aliases: readonly string[];
  yandexLr: number | null;
  millionPlus: boolean;
};
export type CatalogRegion = {
  id: string;
  name: string;
  aliases: readonly string[];
  yandexLr: number | null;
  cities: readonly CatalogCity[];
};

const city = (
  id: string,
  name: string,
  yandexLr: number | null,
  millionPlus: boolean,
  aliases: string[] = [],
): CatalogCity => ({ id, name, yandexLr, millionPlus, aliases });

export const REGIONS: readonly CatalogRegion[] = [
  { id: "moscow", name: "Москва", aliases: ["мск", "г. москва"], yandexLr: 213,
    cities: [city("moscow", "Москва", 213, true, ["мск"])] },
  // lr=1 в справочнике Яндекса — «Москва и Московская область»
  { id: "moscow-oblast", name: "Московская область", aliases: ["подмосковье", "мо"], yandexLr: 1, cities: [] },
  { id: "saint-petersburg", name: "Санкт-Петербург", aliases: ["спб", "питер", "санкт петербург"], yandexLr: 2,
    cities: [city("saint-petersburg", "Санкт-Петербург", 2, true, ["спб", "питер", "санкт петербург"])] },
  { id: "leningrad-oblast", name: "Ленинградская область", aliases: ["ло"], yandexLr: null, cities: [] },
  { id: "novosibirsk-oblast", name: "Новосибирская область", aliases: [], yandexLr: null,
    cities: [city("novosibirsk", "Новосибирск", 65, true)] },
  { id: "sverdlovsk-oblast", name: "Свердловская область", aliases: [], yandexLr: null,
    cities: [city("yekaterinburg", "Екатеринбург", 54, true, ["екб"])] },
  { id: "tatarstan", name: "Республика Татарстан", aliases: ["татарстан"], yandexLr: null,
    cities: [city("kazan", "Казань", 43, true)] },
  { id: "nizhny-novgorod-oblast", name: "Нижегородская область", aliases: [], yandexLr: null,
    cities: [city("nizhny-novgorod", "Нижний Новгород", 47, true, ["нижний"])] },
  { id: "chelyabinsk-oblast", name: "Челябинская область", aliases: [], yandexLr: null,
    cities: [city("chelyabinsk", "Челябинск", 56, true)] },
  { id: "samara-oblast", name: "Самарская область", aliases: [], yandexLr: null,
    cities: [city("samara", "Самара", 51, true)] },
  { id: "omsk-oblast", name: "Омская область", aliases: [], yandexLr: null,
    cities: [city("omsk", "Омск", 66, true)] },
  { id: "rostov-oblast", name: "Ростовская область", aliases: [], yandexLr: null,
    cities: [city("rostov-on-don", "Ростов-на-Дону", 39, true, ["ростов"])] },
  { id: "bashkortostan", name: "Республика Башкортостан", aliases: ["башкирия"], yandexLr: null,
    cities: [city("ufa", "Уфа", 172, true)] },
  { id: "krasnoyarsk-krai", name: "Красноярский край", aliases: [], yandexLr: null,
    cities: [city("krasnoyarsk", "Красноярск", 62, true)] },
  { id: "voronezh-oblast", name: "Воронежская область", aliases: [], yandexLr: null,
    cities: [city("voronezh", "Воронеж", 193, true)] },
  { id: "perm-krai", name: "Пермский край", aliases: [], yandexLr: null,
    cities: [city("perm", "Пермь", 50, true)] },
  { id: "volgograd-oblast", name: "Волгоградская область", aliases: [], yandexLr: null,
    cities: [city("volgograd", "Волгоград", 38, true)] },
  { id: "krasnodar-krai", name: "Краснодарский край", aliases: ["кубань"], yandexLr: null,
    cities: [city("krasnodar", "Краснодар", 35, true), city("sochi", "Сочи", 239, false)] },
  { id: "altai-krai", name: "Алтайский край", aliases: ["алтай"], yandexLr: null,
    cities: [city("barnaul", "Барнаул", 197, false)] },
  { id: "primorsky-krai", name: "Приморский край", aliases: ["приморье"], yandexLr: null,
    cities: [city("vladivostok", "Владивосток", 75, false)] },
  { id: "khabarovsk-krai", name: "Хабаровский край", aliases: [], yandexLr: null,
    cities: [city("khabarovsk", "Хабаровск", 76, false)] },
  { id: "irkutsk-oblast", name: "Иркутская область", aliases: [], yandexLr: null,
    cities: [city("irkutsk", "Иркутск", 63, false)] },
  { id: "kaliningrad-oblast", name: "Калининградская область", aliases: [], yandexLr: null,
    cities: [city("kaliningrad", "Калининград", 22, false)] },
  { id: "stavropol-krai", name: "Ставропольский край", aliases: [], yandexLr: null,
    cities: [city("stavropol", "Ставрополь", 36, false)] },
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
