import { emptyField, field } from "../field";
import type { Supplier } from "../supplier";

/** Все поставщики здесь вымышленные: домены example.*, в названии — «Тест». */
const T = "2026-11-20T10:00:00+03:00";
const src = (url: string, type: Supplier["sources"][number]["type"] = "official-site") => ({
  url,
  type,
  collectedAt: T,
});
const none = <T>() => emptyField<T>();

/** Максимально полная карточка, Москва. */
export const fullSupplier: Supplier = {
  id: "test-mukomol-msk",
  name: "Тест Мукомол",
  website: field("https://mukomol.example.ru", "https://mukomol.example.ru/"),
  description: field(
    "Вымышленный производитель муки и круп для пекарен.",
    "https://mukomol.example.ru/about",
    "medium",
  ),
  categories: ["ingredients", "flour-cereals"],
  contacts: {
    phones: [field("+7 495 000-00-01", "https://mukomol.example.ru/contacts")],
    emails: [field("sales@mukomol.example.ru", "https://mukomol.example.ru/contacts")],
    messengers: [field({ kind: "telegram" as const, handle: "@mukomol_example" }, "https://mukomol.example.ru/contacts", "medium")],
    address: field("Москва, ул. Примерная, 1", "https://mukomol.example.ru/contacts"),
  },
  minOrder: field(
    { quantity: 500, unit: "кг", rawText: "Минимальная партия — от 500 кг" },
    "https://mukomol.example.ru/opt",
  ),
  priceHint: field(
    { min: 38, max: 52, currency: "RUB" as const, unit: "кг", rawText: "от 38 до 52 руб./кг" },
    "https://mukomol.example.ru/price",
    "medium",
  ),
  certificates: field(
    [
      { type: "gost" as const, title: "ГОСТ 26574-2017", documentUrl: null },
      { type: "haccp" as const, title: "ХАССП", documentUrl: "https://mukomol.example.ru/docs/haccp.pdf" },
    ],
    "https://mukomol.example.ru/docs",
  ),
  delivery: {
    regions: field(["moscow", "moscow-oblast"], "https://mukomol.example.ru/delivery"),
    terms: field("Доставка своим транспортом, бесплатно от 2 т", "https://mukomol.example.ru/delivery"),
    pickup: field(true, "https://mukomol.example.ru/delivery"),
  },
  workRegions: field(["moscow", "moscow-oblast", "Тульская область"], "https://mukomol.example.ru/delivery", "low", "Тульская область не из справочника, оставлена как в источнике"),
  sources: [
    src("https://mukomol.example.ru/"),
    src("https://mukomol.example.ru/about"),
    src("https://mukomol.example.ru/contacts"),
    src("https://mukomol.example.ru/opt"),
    src("https://mukomol.example.ru/price"),
    src("https://mukomol.example.ru/docs"),
    src("https://mukomol.example.ru/delivery"),
  ],
  collectedAt: T,
};

/** Только сайт и название: всё остальное «нет данных», Новосибирск. */
export const minimalSupplier: Supplier = {
  id: "test-sibirskiy-sklad",
  name: "Тест Сибирский склад",
  website: field("https://sibsklad.example.com", "https://sibsklad.example.com/"),
  description: none(),
  categories: ["ingredients"],
  contacts: { phones: [], emails: [], messengers: [], address: none() },
  minOrder: none(),
  priceHint: none(),
  certificates: none(),
  delivery: { regions: none(), terms: none(), pickup: none() },
  workRegions: none(),
  sources: [src("https://sibsklad.example.com/")],
  collectedAt: T,
};

/** Нашли только телефон в каталоге, сайта нет; Екатеринбург. */
export const catalogOnlySupplier: Supplier = {
  id: "test-ural-upakovka",
  name: "Тест Урал-Упаковка",
  website: none(),
  description: field("Упаковка для общепита (по данным каталога).", "https://catalog.example.org/ural-upakovka", "low"),
  categories: ["packaging", "containers"],
  contacts: {
    phones: [field("+7 343 000-00-02", "https://catalog.example.org/ural-upakovka", "medium")],
    emails: [],
    messengers: [],
    address: field("Екатеринбург, пр. Условный, 5", "https://catalog.example.org/ural-upakovka", "low"),
  },
  minOrder: none(),
  priceHint: none(),
  certificates: none(),
  delivery: { regions: none(), terms: none(), pickup: none() },
  workRegions: field(["sverdlovsk-oblast"], "https://catalog.example.org/ural-upakovka", "low"),
  sources: [src("https://catalog.example.org/ural-upakovka", "catalog")],
  collectedAt: T,
};

/** Цена и МОЗ только текстом, без чисел; Казань. */
export const rawTextSupplier: Supplier = {
  id: "test-kazan-sladosti",
  name: "Тест Казанские сладости",
  website: field("https://kazan-sweets.example.net", "https://kazan-sweets.example.net/"),
  description: field("Кондитерская продукция оптом.", "https://kazan-sweets.example.net/"),
  categories: ["finished-food", "confectionery"],
  contacts: {
    phones: [field("+7 843 000-00-03", "https://kazan-sweets.example.net/kontakty")],
    emails: [field("opt@kazan-sweets.example.net", "https://kazan-sweets.example.net/kontakty")],
    messengers: [field({ kind: "whatsapp" as const, handle: "+78430000003" }, "https://kazan-sweets.example.net/kontakty", "low")],
    address: none(),
  },
  minOrder: field(
    { quantity: null, unit: null, rawText: "Минимальный заказ обсуждается индивидуально" },
    "https://kazan-sweets.example.net/opt",
    "medium",
  ),
  priceHint: field(
    { min: null, max: null, currency: null, unit: null, rawText: "Цена по запросу, прайс высылаем на почту" },
    "https://kazan-sweets.example.net/opt",
    "medium",
  ),
  certificates: field(
    [{ type: "eaeu-declaration" as const, title: null, documentUrl: null }],
    "https://kazan-sweets.example.net/opt",
    "low",
  ),
  delivery: {
    regions: none(),
    terms: field("Доставка по РТ и соседним регионам", "https://kazan-sweets.example.net/opt", "medium"),
    pickup: none(),
  },
  workRegions: field(["tatarstan"], "https://kazan-sweets.example.net/opt", "medium"),
  sources: [
    src("https://kazan-sweets.example.net/"),
    src("https://kazan-sweets.example.net/kontakty"),
    src("https://kazan-sweets.example.net/opt"),
  ],
  collectedAt: T,
};

/** Заморозка, Краснодар: халяль и органик, доставка по югу. */
export const frozenSupplier: Supplier = {
  id: "test-yug-zamorozka",
  name: "Тест Юг-Заморозка",
  website: field("https://yug-frost.example.ru", "https://yug-frost.example.ru/"),
  description: field("Замороженные ягоды и овощи.", "https://yug-frost.example.ru/about", "medium"),
  categories: ["frozen", "frozen-veg"],
  contacts: {
    phones: [
      field("+7 861 000-00-04", "https://yug-frost.example.ru/contacts"),
      field("+7 861 000-00-05", "https://yug-frost.example.ru/contacts", "medium"),
    ],
    emails: [field("info@yug-frost.example.ru", "https://yug-frost.example.ru/contacts")],
    messengers: [],
    address: field("Краснодар, ул. Тестовая, 10", "https://yug-frost.example.ru/contacts"),
  },
  minOrder: field({ quantity: 1, unit: "т", rawText: "От 1 тонны" }, "https://yug-frost.example.ru/opt"),
  priceHint: field(
    { min: 120, max: null, currency: "RUB" as const, unit: "кг", rawText: "от 120 руб./кг" },
    "https://yug-frost.example.ru/opt",
    "medium",
  ),
  certificates: field(
    [
      { type: "halal" as const, title: "Халяль", documentUrl: "https://yug-frost.example.ru/docs/halal.pdf" },
      { type: "organic" as const, title: null, documentUrl: null },
    ],
    "https://yug-frost.example.ru/docs",
    "medium",
  ),
  delivery: {
    regions: field(["krasnodar-krai", "stavropol-krai", "rostov-oblast"], "https://yug-frost.example.ru/delivery"),
    terms: field("Рефрижератор, от 500 кг", "https://yug-frost.example.ru/delivery"),
    pickup: field(false, "https://yug-frost.example.ru/delivery", "low"),
  },
  workRegions: field(["krasnodar-krai", "stavropol-krai", "rostov-oblast"], "https://yug-frost.example.ru/delivery"),
  sources: [
    src("https://yug-frost.example.ru/"),
    src("https://yug-frost.example.ru/about"),
    src("https://yug-frost.example.ru/contacts"),
    src("https://yug-frost.example.ru/opt"),
    src("https://yug-frost.example.ru/docs"),
    src("https://yug-frost.example.ru/delivery"),
  ],
  collectedAt: T,
};

/** Напитки, Санкт-Петербург; источники — маркетплейс и реестр, собраны в разные даты. */
export const marketplaceSupplier: Supplier = {
  id: "test-neva-napitki",
  name: "Тест Нева-Напитки",
  website: field("https://neva-drinks.example.org", "https://neva-drinks.example.org/"),
  description: none(),
  categories: ["beverages", "juices"],
  contacts: {
    phones: [],
    emails: [field("zakaz@neva-drinks.example.org", "https://market.example.com/neva-drinks", "medium")],
    messengers: [field({ kind: "telegram" as const, handle: "@neva_drinks_test" }, "https://neva-drinks.example.org/", "low")],
    address: none(),
  },
  minOrder: none(),
  priceHint: field(
    { min: 60, max: 90, currency: "RUB" as const, unit: "л", rawText: "60–90 ₽ за литр" },
    "https://market.example.com/neva-drinks",
    "low",
    "Цена с маркетплейса, может отличаться от прайса",
  ),
  certificates: none(),
  delivery: {
    regions: field(["saint-petersburg", "leningrad-oblast"], "https://neva-drinks.example.org/", "medium"),
    terms: none(),
    pickup: none(),
  },
  workRegions: field(["saint-petersburg", "leningrad-oblast"], "https://neva-drinks.example.org/", "medium"),
  sources: [
    src("https://neva-drinks.example.org/"),
    { url: "https://market.example.com/neva-drinks", type: "marketplace", collectedAt: "2026-11-19T18:30:00+03:00" },
    { url: "https://registry.example.org/neva-drinks", type: "registry", collectedAt: "2026-11-19T18:35:00+03:00" },
  ],
  collectedAt: T,
};

/** Специи, Барнаул: ISO и ТУ, самовывоз. */
export const spicesSupplier: Supplier = {
  id: "test-altay-specii",
  name: "Тест Алтайские специи",
  website: field("https://altai-spice.example.ru", "https://altai-spice.example.ru/"),
  description: field("Специи и сборы трав, фасовка и развес.", "https://altai-spice.example.ru/about"),
  categories: ["spices", "spices-herbs"],
  contacts: {
    phones: [field("+7 385 000-00-06", "https://altai-spice.example.ru/contacts")],
    emails: [],
    messengers: [field({ kind: "viber" as const, handle: "+73850000006" }, "https://altai-spice.example.ru/contacts", "medium")],
    address: field("Барнаул, пер. Образцовый, 3", "https://altai-spice.example.ru/contacts"),
  },
  minOrder: field({ quantity: 20, unit: "кг", rawText: "Опт от 20 кг" }, "https://altai-spice.example.ru/opt"),
  priceHint: none(),
  certificates: field(
    [
      { type: "iso" as const, title: "ISO 22000", documentUrl: null },
      { type: "tu" as const, title: "ТУ 10.84.12-001-00000000-2024", documentUrl: null },
    ],
    "https://altai-spice.example.ru/docs",
    "medium",
  ),
  delivery: {
    regions: none(),
    terms: field("Отправка транспортными компаниями по России", "https://altai-spice.example.ru/opt", "medium"),
    pickup: field(true, "https://altai-spice.example.ru/contacts"),
  },
  workRegions: field(["altai-krai"], "https://altai-spice.example.ru/opt", "medium"),
  sources: [
    src("https://altai-spice.example.ru/"),
    src("https://altai-spice.example.ru/about"),
    src("https://altai-spice.example.ru/contacts"),
    src("https://altai-spice.example.ru/opt"),
    src("https://altai-spice.example.ru/docs"),
  ],
  collectedAt: T,
};

export const supplierFixtures: readonly Supplier[] = [
  fullSupplier,
  minimalSupplier,
  catalogOnlySupplier,
  rawTextSupplier,
  frozenSupplier,
  marketplaceSupplier,
  spicesSupplier,
];
