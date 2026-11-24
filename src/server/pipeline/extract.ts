import { z } from "zod";
import {
  allCategoryIds,
  CATEGORIES,
  CERTIFICATE_TYPES,
  type Certificate,
  type Confidence,
  emptyField,
  findCity,
  findRegion,
  normalizeLocation,
  type SourcedField,
  type Supplier,
} from "@/domain";
import type { LlmProvider } from "../llm/types";
import { CATEGORY_LIST_TEXT } from "./catalog-text";
import {
  anyNameInText,
  categoryInText,
  containsText,
  findQuote,
  normText,
  numberInText,
  paraphraseSupported,
  phoneInText,
  digitsOf,
  unitInText,
  type QuoteMatch,
} from "./grounding";
import { buildExtractUserPrompt, EXTRACT_SYSTEM_PROMPT } from "./prompts/extract";
import type { Candidate, CandidateOutcome, DroppedField, FetchedPage, NormalizedQuery } from "./types";

// ---------- схема ответа модели ----------
// Отдельно от доменной Supplier: у каждого значения — цитата и URL, которые код потом проверяет.

const quote = z.string().describe("Дословный фрагмент текста страницы");
const url = z.string().describe("URL страницы с этой цитатой");
const TextFact = z.object({ value: z.string(), quote, url });
const ListFact = z.object({ values: z.array(z.string()), quote, url });
const CATEGORY_IDS = allCategoryIds();

/** Названия, по которым ищем подтверждение категории: у верхнего уровня — и подкатегории (id уникальны во всём справочнике). */
function categoryLabels(id: string): string[] {
  const top = CATEGORIES.find((c) => c.id === id);
  if (top) return [top.label, ...top.subcategories.map((s) => s.label)];
  return CATEGORIES.flatMap((c) => c.subcategories).filter((s) => s.id === id).map((s) => s.label);
}

export const ExtractionSchema = z.object({
  isSupplier: z.boolean(),
  notSupplierReason: z.string().nullable(),
  companyName: TextFact.nullable(),
  description: TextFact.nullable(),
  phones: z.array(TextFact),
  emails: z.array(TextFact),
  messengers: z.array(
    z.object({ kind: z.enum(["telegram", "whatsapp", "viber", "max", "other"]), handle: z.string(), quote, url }),
  ),
  address: TextFact.nullable(),
  minOrder: z.object({ quantity: z.number().nullable(), unit: z.string().nullable(), quote, url }).nullable(),
  price: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.enum(["RUB", "USD", "EUR", "KZT", "BYN", "CNY"]).nullable(),
      unit: z.string().nullable(),
      quote,
      url,
    })
    .nullable(),
  certificates: z.array(z.object({ type: z.enum(CERTIFICATE_TYPES), title: z.string().nullable(), quote, url })),
  deliveryTerms: TextFact.nullable(),
  deliveryRegions: ListFact.nullable(),
  pickup: z.object({ value: z.boolean(), quote, url }).nullable(),
  workRegions: ListFact.nullable(),
  // строки, а не enum: выдуманный id отбрасывается кодом, а не роняет разбор всего ответа
  categoryIds: z.array(z.string()),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// ---------- проверка цитат ----------

const normUrl = (u: string) => u.replace(/\/+$/, "").replace(/^http:/, "https:").replace("://www.", "://");

type Evidence = { quote: string; url: string };
type Grounded = { page: FetchedPage; match: Exclude<QuoteMatch, null> };

class Grounder {
  readonly dropped: DroppedField[] = [];
  constructor(
    private readonly pages: FetchedPage[],
    private readonly domain: string,
  ) {}

  drop(path: string, value: unknown, reason: string) {
    this.dropped.push({ domain: this.domain, path, value: typeof value === "string" ? value : JSON.stringify(value), reason });
  }

  /** Находит страницу, где стоит цитата: сначала указанную моделью, потом любую из загруженных. */
  locate(ev: Evidence): Grounded | null {
    const cited = this.pages.find((p) => normUrl(p.url) === normUrl(ev.url));
    const order = cited ? [cited, ...this.pages.filter((p) => p !== cited)] : this.pages;
    let weak: Grounded | null = null;
    for (const page of order) {
      const m = findQuote(ev.quote, `${page.title}\n${page.text}`);
      if (m === "exact") return { page, match: m };
      if (m === "tokens" && !weak) weak = { page, match: m };
    }
    return weak;
  }

  /** Проверяет цитату; при неудаче записывает отброшенное поле. */
  check(path: string, value: unknown, ev: Evidence): Grounded | null {
    if (!ev.quote?.trim()) {
      this.drop(path, value, "нет цитаты-источника");
      return null;
    }
    const g = this.locate(ev);
    if (!g) this.drop(path, value, "цитата не найдена на страницах сайта");
    return g;
  }
}

const conf = (g: Grounded, valueLiteral: boolean): Confidence =>
  g.match === "tokens" ? "low" : valueLiteral ? "high" : "medium";

function sourced<T>(value: T, g: Grounded, c: Confidence, note?: string): SourcedField<T> {
  return { value, sourceUrl: g.page.url, confidence: c, ...(note ? { note } : {}) };
}

/** Однострочный текст для карточки: переносы со страницы схлопываются, длинное обрезается. */
const clip = (raw: string, n = 200) => {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const CERT_KEYWORDS: Record<string, RegExp> = {
  gost: /гост|gost/i,
  tu: /(^|[^а-я])ту([^а-я]|$)|технически[ех] услови/i,
  "eaeu-declaration": /деклараци|еаэс|тр тс|тр\/тс|eac/i,
  haccp: /хассп|haccp/i,
  iso: /iso|исо/i,
  halal: /халял|халяль|halal/i,
  organic: /органик|organic|органическ/i,
  other: /./,
};

const CURRENCY_SIGNS: Record<string, RegExp> = {
  RUB: /руб|₽|(^|[\s\d])р(\.|$|[^а-яё])|rub/i,
  USD: /\$|usd|доллар/i,
  EUR: /€|eur|евро/i,
  KZT: /тенге|₸|kzt/i,
  BYN: /бел\.?\s?руб|byn/i,
  CNY: /юан|¥|cny/i,
};

/** Номер телефона стоит целиком в одной строке страницы (цифры соседних номеров не склеиваются). */
const lineHasPhone = (pageText: string, phone: string) => pageText.split("\n").some((line) => phoneInText(phone, line));

/** Название места → id региона/города справочника (если распознано) и имена для проверки по цитате. */
function placeEntry(name: string): { entry: string; names: string[] } {
  const loc = normalizeLocation(name);
  if (!loc) return { entry: name.trim(), names: [name] };
  const region = findRegion(loc.regionId)!;
  const city = loc.cityId ? findCity(loc.cityId)?.city : undefined;
  const names = city ? [city.name, ...city.aliases, name] : [region.name, ...region.aliases, name];
  return { entry: city ? city.id : region.id, names };
}

const RUSSIA = /^(россия|рф|вся россия|по всей россии|по россии|российская федерация)$/i;

function groundPlaces(gr: Grounder, path: string, fact: z.infer<typeof ListFact> | null): SourcedField<string[]> {
  if (!fact || !fact.values.length) return emptyField();
  const g = gr.check(path, fact.values, fact);
  if (!g) return emptyField();
  const kept: string[] = [];
  for (const v of fact.values) {
    if (RUSSIA.test(v.trim())) {
      if (/росси|рф\b/i.test(fact.quote)) kept.push("Россия");
      else gr.drop(path, v, "«Россия» не следует из цитаты");
      continue;
    }
    const p = placeEntry(v);
    if (anyNameInText(p.names, fact.quote)) kept.push(p.entry);
    else gr.drop(path, v, "место не упомянуто в цитате");
  }
  const uniq = [...new Set(kept)];
  return uniq.length ? sourced(uniq, g, conf(g, true)) : emptyField();
}

const filledCount = (s: Supplier) =>
  [s.website, s.description, s.contacts.address, s.minOrder, s.priceHint, s.certificates, s.delivery.regions,
    s.delivery.terms, s.delivery.pickup, s.workRegions].filter((f) => f.value !== null).length +
  s.contacts.phones.length + s.contacts.emails.length + s.contacts.messengers.length;

export { filledCount };

/**
 * Превращает ответ модели в доменную карточку. Каждое значение проходит проверку:
 * цитата есть на странице, а само значение следует из цитаты. Остальное — в dropped.
 */
export function buildSupplier(
  ex: Extraction,
  ctx: { candidate: Candidate; pages: FetchedPage[]; nq: NormalizedQuery; collectedAt: string },
): { supplier: Supplier; dropped: DroppedField[] } {
  const { candidate, pages, nq } = ctx;
  const gr = new Grounder(pages, candidate.domain);
  const landing = pages[0];
  const origin = new URL(landing.url).origin;

  // Название: подтверждённое страницей, иначе домен (не выдумываем)
  let name = candidate.domain;
  if (ex.companyName?.value.trim()) {
    const g = gr.check("name", ex.companyName.value, ex.companyName);
    if (g && containsText(`${g.page.title}\n${g.page.text}`, ex.companyName.value)) name = ex.companyName.value.trim();
    else if (g) gr.drop("name", ex.companyName.value, "название не совпадает с текстом страницы");
  }

  let description: SourcedField<string> = emptyField();
  if (ex.description?.value.trim()) {
    const d = ex.description;
    const g = gr.check("description", d.value, d);
    if (g) {
      // Пересказ цитаты — medium; пересказ, опирающийся на текст страницы шире цитаты, — low
      if (paraphraseSupported(d.value, `${d.quote}\n${g.page.title}`, 0.5)) description = sourced(clip(d.value.trim(), 300), g, g.match === "tokens" ? "low" : "medium");
      else if (paraphraseSupported(d.value, `${g.page.title}\n${g.page.text}`, 0.85)) description = sourced(clip(d.value.trim(), 300), g, "low");
      else gr.drop("description", d.value, "описание не опирается на страницу");
    }
  }

  // Контакты
  const phones: SourcedField<string>[] = [];
  const seenPhones = new Set<string>();
  for (const [i, p] of ex.phones.entries()) {
    const g = gr.check(`contacts.phones.${i}`, p.value, p);
    if (!g) continue;
    // Номер в цитате — high; цитата указывает на другое место страницы (например, «позвоните нам»),
    // а сам номер стоит в отдельной строке той же страницы — medium
    const inQuote = phoneInText(p.value, p.quote);
    if (!inQuote && !lineHasPhone(g.page.text, p.value)) {
      gr.drop(`contacts.phones.${i}`, p.value, "цифры телефона не совпадают с цитатой");
      continue;
    }
    const key = digitsOf(p.value).slice(-10);
    if (seenPhones.has(key)) continue;
    seenPhones.add(key);
    phones.push(sourced(p.value.trim(), g, inQuote ? conf(g, true) : "medium"));
  }

  const emails: SourcedField<string>[] = [];
  for (const [i, e] of ex.emails.entries()) {
    const value = e.value.trim().toLowerCase().replace(/^mailto:/, "");
    const g = gr.check(`contacts.emails.${i}`, value, e);
    if (!g) continue;
    const inQuote = normText(e.quote).includes(value);
    if (!z.email().safeParse(value).success || (!inQuote && !normText(g.page.text).includes(value))) {
      gr.drop(`contacts.emails.${i}`, value, "адрес почты не совпадает с цитатой");
      continue;
    }
    if (!emails.some((x) => x.value === value)) emails.push(sourced(value, g, inQuote ? conf(g, true) : "medium"));
  }

  const messengers: Supplier["contacts"]["messengers"] = [];
  for (const [i, m] of ex.messengers.entries()) {
    const handle = m.handle.trim();
    const g = gr.check(`contacts.messengers.${i}`, handle, m);
    if (!g) continue;
    const bare = handle.replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").toLowerCase();
    if (!bare || (!normText(m.quote).includes(bare) && !phoneInText(bare, m.quote))) {
      gr.drop(`contacts.messengers.${i}`, handle, "контакт мессенджера не совпадает с цитатой");
      continue;
    }
    messengers.push(sourced({ kind: m.kind, handle }, g, conf(g, true)));
  }

  let address: SourcedField<string> = emptyField();
  if (ex.address?.value.trim()) {
    const a = ex.address;
    const g = gr.check("contacts.address", a.value, a);
    if (g) {
      const literal = containsText(a.quote, a.value);
      if (literal || paraphraseSupported(a.value, a.quote, 0.8)) address = sourced(a.value.trim(), g, conf(g, literal));
      else gr.drop("contacts.address", a.value, "адрес не совпадает с цитатой");
    }
  }

  // Минимальный заказ
  let minOrder: Supplier["minOrder"] = emptyField();
  if (ex.minOrder) {
    const mo = ex.minOrder;
    const g = gr.check("minOrder", mo, mo);
    if (g) {
      const qtyOk = mo.quantity === null || (mo.quantity > 0 && numberInText(mo.quantity, mo.quote));
      const unitOk = mo.unit === null || unitInText(mo.unit, mo.quote);
      if (!qtyOk) gr.drop("minOrder.quantity", mo.quantity, "числа нет в цитате");
      if (!unitOk) gr.drop("minOrder.unit", mo.unit, "единицы нет в цитате");
      const quantity = qtyOk ? mo.quantity : null;
      const unit = unitOk && mo.unit ? mo.unit.trim() : null;
      if (/доставк|самовывоз/i.test(mo.quote)) {
        gr.drop("minOrder", mo, "цитата об условиях доставки или самовывоза");
      } else if (quantity === null && !unit) {
        gr.drop("minOrder", mo, "нет подтверждённого количества или единицы");
      } else {
        minOrder = sourced({ quantity, unit, rawText: clip(mo.quote.trim()) }, g, conf(g, qtyOk && unitOk && quantity !== null));
      }
    }
  }

  // Цена
  let priceHint: Supplier["priceHint"] = emptyField();
  if (ex.price) {
    const pr = ex.price;
    const g = gr.check("priceHint", pr, pr);
    if (g && (pr.min === 0 || pr.max === 0)) {
      gr.drop("priceHint", pr.quote, "нулевая цена");
    } else if (g) {
      let min = pr.min !== null && pr.min >= 0 && numberInText(pr.min, pr.quote) ? pr.min : null;
      let max = pr.max !== null && pr.max >= 0 && numberInText(pr.max, pr.quote) ? pr.max : null;
      if (pr.min !== null && min === null) gr.drop("priceHint.min", pr.min, "числа нет в цитате");
      if (pr.max !== null && max === null) gr.drop("priceHint.max", pr.max, "числа нет в цитате");
      if (min !== null && max !== null && min > max) [min, max] = [max, min];
      const currency = pr.currency && CURRENCY_SIGNS[pr.currency].test(pr.quote) ? pr.currency : null;
      if (pr.currency && !currency) gr.drop("priceHint.currency", pr.currency, "валюты нет в цитате");
      const unit = pr.unit && unitInText(pr.unit, pr.quote) ? pr.unit.trim() : null;
      if (min === null && max === null) gr.drop("priceHint", pr.quote, "в цитате нет указанной цены");
      else priceHint = sourced({ min, max, currency, unit, rawText: clip(pr.quote.trim()) }, g, conf(g, true));
    }
  }

  // Сертификаты
  const certs: Certificate[] = [];
  let certGround: Grounded | null = null;
  let certWeak = false;
  for (const [i, c] of ex.certificates.entries()) {
    const g = gr.check(`certificates.${i}`, c, c);
    if (!g) continue;
    if (!CERT_KEYWORDS[c.type].test(c.quote)) {
      gr.drop(`certificates.${i}`, c.type, "тип документа не следует из цитаты");
      continue;
    }
    const title = c.title && containsText(c.quote, c.title) ? clip(c.title.trim(), 120) : null;
    if (certs.some((x) => x.type === c.type && x.title === title)) continue;
    certs.push({ type: c.type, title, documentUrl: null });
    certGround ??= g;
    if (g.match === "tokens") certWeak = true;
  }
  // У поля один sourceUrl: берём страницу первого подтверждённого документа
  const certificates: Supplier["certificates"] =
    certs.length && certGround ? sourced(certs, certGround, certWeak ? "low" : "high") : emptyField();

  // Доставка
  let terms: SourcedField<string> = emptyField();
  if (ex.deliveryTerms?.value.trim()) {
    const t = ex.deliveryTerms;
    const g = gr.check("delivery.terms", t.value, t);
    if (g) {
      const literal = containsText(t.quote, t.value);
      if (literal || paraphraseSupported(t.value, t.quote, 0.6)) terms = sourced(clip(t.value.trim(), 300), g, conf(g, literal));
      // Модель часто сводит условия с нескольких строк одной страницы: допускаем, но с low
      else if (paraphraseSupported(t.value, g.page.text, 0.85)) terms = sourced(clip(t.value.trim(), 300), g, "low");
      else gr.drop("delivery.terms", t.value, "условия не опираются на страницу");
    }
  }
  let pickup: SourcedField<boolean> = emptyField();
  if (ex.pickup) {
    const p = ex.pickup;
    const g = gr.check("delivery.pickup", p.value, p);
    if (g) {
      const mentions = /самовывоз|забрать|заберите|пункт(ы|ов)? выдачи/i.test(p.quote);
      const negated = /(нет|не\s+(осуществля|предусмотр|возможен|работа))/i.test(p.quote);
      if (mentions && p.value !== negated) pickup = sourced(p.value, g, conf(g, true));
      else gr.drop("delivery.pickup", p.value, "самовывоз не следует из цитаты");
    }
  }

  // Категории: только из справочника и только если о них есть слово на страницах сайта
  const pagesText = pages.map((p) => `${p.title}\n${p.text}`).join("\n");
  const categories: string[] = [];
  for (const id of new Set(ex.categoryIds)) {
    if (!CATEGORY_IDS.includes(id)) {
      gr.drop("categories", id, "категории нет в справочнике");
      continue;
    }
    if (categoryInText(categoryLabels(id), pagesText)) categories.push(id);
    else gr.drop("categories", id, "на страницах нет подтверждения категории");
  }
  const supplier: Supplier = {
    id: candidate.domain.replace(/[^a-z0-9а-я]+/gi, "-").toLowerCase(),
    name: clip(name, 120),
    website: { value: `${origin}/`, sourceUrl: landing.url, confidence: "high" },
    description,
    categories: categories.length ? categories : nq.categoryIds.length ? nq.categoryIds : ["other-food"],
    contacts: { phones: phones.slice(0, 5), emails: emails.slice(0, 5), messengers: messengers.slice(0, 5), address },
    minOrder,
    priceHint,
    certificates,
    delivery: { regions: groundPlaces(gr, "delivery.regions", ex.deliveryRegions), terms, pickup },
    workRegions: groundPlaces(gr, "workRegions", ex.workRegions),
    sources: pages.map((p) => ({ url: p.url, type: "official-site" as const, collectedAt: ctx.collectedAt })),
    collectedAt: ctx.collectedAt,
  };
  return { supplier, dropped: gr.dropped };
}

/** Шаг извлечения: промпт → структурированный ответ модели → проверка цитат → карточка или отказ. */
export async function extractSupplier(
  candidate: Candidate,
  pages: FetchedPage[],
  nq: NormalizedQuery,
  llm: LlmProvider,
  opts: { collectedAt: string; signal?: AbortSignal },
): Promise<Exclude<CandidateOutcome, { status: "failed" }>> {
  const r = await llm.extractStructured({
    schemaName: "supplier_extraction",
    schema: ExtractionSchema,
    system: EXTRACT_SYSTEM_PROMPT,
    user: buildExtractUserPrompt({
      productPhrase: nq.productPhrase,
      placeLabel: nq.placeLabel,
      categoryList: CATEGORY_LIST_TEXT,
      pages: pages.map((p) => ({ url: p.url, title: p.title, text: p.text })),
    }),
    maxTokens: 2500,
    signal: opts.signal,
  });
  const ex = r.data;
  if (!ex.isSupplier) {
    return { status: "rejected", domain: candidate.domain, reason: clip(ex.notSupplierReason?.replace(/\s+/g, " ").trim() || "не похоже на сайт поставщика", 200), dropped: [] };
  }
  const { supplier, dropped } = buildSupplier(ex, { candidate, pages, nq, collectedAt: opts.collectedAt });
  // Вердикт модели «это поставщик» сам ничем не подтверждён: нужен хоть один факт, найденный на странице
  // (подтверждённое название или любое поле, кроме адреса сайта). Иначе страница могла просто заявить о себе.
  if (supplier.name === candidate.domain && filledCount(supplier) <= 1) {
    return { status: "rejected", domain: candidate.domain, reason: "на страницах нет подтверждённых данных о компании", dropped };
  }
  return { status: "supplier", domain: candidate.domain, supplier, dropped };
}
