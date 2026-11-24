import { z } from "zod";
import { allCategoryIds } from "./catalog";
import { sourcedField } from "./field";
import { CertificateTypeSchema } from "./query";

const text = z.string().trim().min(1);
const isoDate = z.iso.datetime({ offset: true });

export const MessengerSchema = z.strictObject({
  kind: z.enum(["telegram", "whatsapp", "viber", "max", "other"]),
  handle: text,
});

export const MinOrderSchema = z.strictObject({
  quantity: z.number().positive().nullable(),
  unit: text.nullable(),
  /** Формулировка с сайта «как есть». */
  rawText: text,
});

export const PriceHintSchema = z
  .strictObject({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.enum(["RUB", "USD", "EUR", "KZT", "BYN", "CNY"]).nullable(),
    unit: text.nullable(),
    rawText: text,
  })
  .refine((p) => p.min === null || p.max === null || p.min <= p.max, {
    message: "Минимальная цена больше максимальной",
    path: ["min"],
  });

export const CertificateSchema = z.strictObject({
  type: CertificateTypeSchema,
  title: text.nullable(),
  documentUrl: z.url({ protocol: /^https?$/ }).nullable(),
});

export const SourceTypeSchema = z.enum([
  "official-site", "catalog", "search-result", "marketplace", "registry", "other",
]);
export const SourceSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  type: SourceTypeSchema,
  collectedAt: isoDate,
});

export const SupplierContactsSchema = z.strictObject({
  phones: z.array(sourcedField(text)),
  emails: z.array(sourcedField(z.email())),
  messengers: z.array(sourcedField(MessengerSchema)),
  address: sourcedField(text),
});

export const SupplierDeliverySchema = z.strictObject({
  regions: sourcedField(z.array(text).min(1)),
  terms: sourcedField(text),
  pickup: sourcedField(z.boolean()),
});

const knownCategoryIds = new Set(allCategoryIds());

type Sourced = { value: unknown; sourceUrl: string | null };
const isSourced = (v: unknown): v is Sourced =>
  typeof v === "object" && v !== null && "sourceUrl" in v && "confidence" in v && "value" in v;

/** Обходит объект и собирает все поля с происхождением вместе с путём. */
function collectSourced(node: unknown, path: (string | number)[], out: { path: (string | number)[]; f: Sourced }[]) {
  if (isSourced(node)) {
    out.push({ path, f: node });
    return;
  }
  if (Array.isArray(node)) node.forEach((x, i) => collectSourced(x, [...path, i], out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) collectSourced(v, [...path, k], out);
}

export const SupplierSchema = z
  .strictObject({
    id: text,
    name: text,
    website: sourcedField(z.url({ protocol: /^https?$/ })),
    description: sourcedField(text),
    categories: z.array(text).min(1),
    contacts: SupplierContactsSchema,
    minOrder: sourcedField(MinOrderSchema),
    priceHint: sourcedField(PriceHintSchema),
    certificates: sourcedField(z.array(CertificateSchema).min(1)),
    delivery: SupplierDeliverySchema,
    workRegions: sourcedField(z.array(text).min(1)),
    sources: z.array(SourceSchema),
    collectedAt: isoDate,
  })
  .superRefine((s, ctx) => {
    s.categories.forEach((c, i) => {
      if (!knownCategoryIds.has(c)) {
        ctx.addIssue({ code: "custom", path: ["categories", i], message: `Категории «${c}» нет в справочнике` });
      }
    });
    // Каждый sourceUrl поля обязан быть в перечне sources: источник можно проверить.
    const known = new Set(s.sources.map((x) => x.url));
    const found: { path: (string | number)[]; f: Sourced }[] = [];
    collectSourced({ website: s.website, description: s.description, contacts: s.contacts, minOrder: s.minOrder,
      priceHint: s.priceHint, certificates: s.certificates, delivery: s.delivery, workRegions: s.workRegions }, [], found);
    for (const { path, f } of found) {
      if (f.sourceUrl !== null && !known.has(f.sourceUrl)) {
        ctx.addIssue({ code: "custom", path: [...path, "sourceUrl"], message: "Источник поля отсутствует в списке sources" });
      }
    }
  });

export type Supplier = z.infer<typeof SupplierSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type Source = z.infer<typeof SourceSchema>;
