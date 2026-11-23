import type { SearchQueryInput } from "../query";

export const validQueryFixtures: Record<string, SearchQueryInput> = {
  catalogMoscow: {
    category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
    product: "мука пшеничная в/с",
    location: { regionId: "moscow", cityId: "moscow" },
    needCertificates: ["gost", "haccp"],
    maxMinOrder: { value: 1000, unit: "кг" },
    needDelivery: true,
    priceImportance: "high",
  },
  freeTextRegion: {
    category: { kind: "free", text: "крафтовая упаковка для кофе" },
    product: "",
    location: { regionId: "krasnodar-krai", cityId: null },
  },
};
