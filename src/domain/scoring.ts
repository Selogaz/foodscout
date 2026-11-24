import { CATEGORIES, findCategory, findCity, findRegion, findSubcategory, REGIONS } from "./catalog";
import type { Confidence } from "./field";
import { CERTIFICATE_LABELS, type CertificateType, type SearchQuery } from "./query";
import type { Supplier } from "./supplier";

/**
 * Детерминированный скоринг поставщиков под запрос. Чистые функции, без LLM и без сети:
 * один и тот же вход всегда даёт один и тот же результат.
 *
 * Принцип: баллы даёт только то, что подтверждено источником. «Нет данных» не засчитывается
 * как совпадение, но и не считается нарушением: об этом говорит список `missing`.
 */

export type CriterionId =
  | "category"
  | "region"
  | "filters"
  | "completeness"
  | "contacts"
  | "confidence";

/** Все настройки скоринга в одном месте. Сумма весов — 100. */
export const SCORING_CONFIG = {
  weights: {
    category: 25,
    region: 25,
    filters: 20,
    contacts: 12,
    completeness: 10,
    confidence: 8,
  } satisfies Record<CriterionId, number>,
  labels: {
    category: "Категория и товар",
    region: "Регион",
    filters: "Фильтры запроса",
    completeness: "Полнота карточки",
    contacts: "Контакты",
    confidence: "Надёжность данных",
  } satisfies Record<CriterionId, string>,
  /** Множитель вклада поля по уверенности извлечения. */
  confidenceFactor: { high: 1, medium: 0.85, low: 0.5 } satisfies Record<Confidence, number>,
  /** Доверие к данным для критерия «надёжность» (low почти не доверяем). */
  confidenceTrust: { high: 1, medium: 0.65, low: 0.25 } satisfies Record<Confidence, number>,
  /** Минимальный множитель итога при нулевой релевантности категории. */
  relevanceFloor: 0.2,
  /** Доля балла категории, отдаваемая за совпадение конкретного товара (если он указан). */
  productShare: 0.35,
  /** Балл региона по тому, чем подтверждено покрытие. */
  regionLevel: { delivery: 1, work: 0.85, address: 0.6, russiaWide: 0.5 },
  /** Баллы за каналы связи (в сумме 1). */
  contactParts: { phone: 0.35, email: 0.3, messenger: 0.15, website: 0.2 },
  /** Вес поля в «полноте»; цена зависит от важности цены в запросе. */
  completenessWeights: {
    website: 2,
    description: 1,
    address: 1,
    minOrder: 1,
    certificates: 1,
    delivery: 1,
    workRegions: 1,
    price: { low: 0.5, medium: 1, high: 2 },
  },
} as const;

export type CriterionScore = {
  id: CriterionId;
  label: string;
  weight: number;
  /** 0..1 — насколько поставщик закрывает критерий. */
  score: number;
  /** score × weight. */
  points: number;
  /** false — критерий не участвует (в запросе нет соответствующих фильтров). */
  applicable: boolean;
};

export type SupplierScore = {
  supplierId: string;
  /** Целое 0–100, нормировано на веса применимых критериев. */
  total: number;
  /** Множитель релевантности категории (0.2–1), применён к итогу: чужая категория не может быть в топе. */
  relevanceFactor: number;
  breakdown: CriterionScore[];
  /** Что совпало с запросом (короткие русские фразы). */
  pros: string[];
  /** Что не совпало или противоречит запросу. */
  cons: string[];
  /** Каких данных не хватает. */
  missing: string[];
};

export type RankedSupplier = {
  supplier: Supplier;
  score: SupplierScore;
  /** Место в выдаче, с 1. */
  rank: number;
  /** Критерии, по которым поставщик лучший в этой выдаче («лучший по …»). */
  bestFor: CriterionId[];
};

// ---------- утилиты ----------

const cf = (c: Confidence | null) => (c ? SCORING_CONFIG.confidenceFactor[c] : 0);
const trust = (c: Confidence | null) => (c ? SCORING_CONFIG.confidenceTrust[c] : 0);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const uniq = (xs: string[]) => [...new Set(xs)];
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const list = (xs: string[]) => xs.join(", ");

type Filled<T> = { value: T; confidence: Confidence | null };
function present<T>(f: { value: T | null; confidence: Confidence | null }): f is Filled<T> {
  return f.value !== null;
}

const STOPWORDS = new Set(["для", "при", "над", "под", "без", "про", "или", "как", "что", "это", "все", "его", "оптом", "опт"]);

/** Основа слова для грубого сравнения русских словоформ: «пшеничная» ≈ «пшеничной». */
function stems(text: string): string[] {
  return uniq(
    norm(text)
      .split(/[^a-zа-я0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map((w) => w.slice(0, Math.min(6, Math.max(3, w.length - 2)))),
  );
}

/** Название категории или подкатегории по id (для текстов и сверки по описанию). */
const CATEGORY_LABELS = new Map<string, string>(
  CATEGORIES.flatMap((c) => [[c.id, c.label] as [string, string], ...c.subcategories.map((x) => [x.id, x.label] as [string, string])]),
);
const categoryLabel = (id: string) => CATEGORY_LABELS.get(id) ?? id;

type LocationText = {
  /** Название в именительном падеже (для конструкций «Адрес — X», «работает: X»). */
  name: string;
  /** Форма после предлога: «в Москве» из справочника, иначе «(Тульская область)» без склонения. */
  place: string;
  /** Направление после предлога: «в Москву» (винительный) из справочника, иначе «(Тульская область)». */
  to: string;
};

function queryLocationText(q: SearchQuery): LocationText {
  const c = q.location.cityId ? findCity(q.location.cityId)?.city : undefined;
  const known = c ?? findRegion(q.location.regionId);
  if (known) return { name: known.name, place: known.locative, to: known.accusative };
  const name = q.location.regionId;
  return { name, place: `(${name})`, to: `(${name})` };
}

function knownRegions(s: Supplier): string[] {
  return uniq([
    ...(present(s.delivery.regions) ? s.delivery.regions.value.map(regionLabel) : []),
    ...(present(s.workRegions) ? s.workRegions.value.map(regionLabel) : []),
  ]);
}

function regionLabel(entry: string): string {
  return findCity(entry)?.city.name ?? findRegion(entry)?.name ?? entry;
}

/** Приводит запись региона (id региона, id города или название) к id региона справочника. */
function resolveRegionId(entry: string): string | null {
  if (findRegion(entry)) return entry;
  const city = findCity(entry);
  if (city) return city.region.id;
  const n = norm(entry);
  return REGION_BY_NAME.get(n) ?? null;
}

const REGION_BY_NAME = new Map<string, string>(
  REGIONS.flatMap((r) => [
    [norm(r.name), r.id] as [string, string],
    ...r.aliases.map((a) => [norm(a), r.id] as [string, string]),
    ...r.cities.map((c) => [norm(c.name), r.id] as [string, string]),
  ]),
);

const UNITS: Record<string, { dim: string; k: number }> = {
  кг: { dim: "mass", k: 1 }, килограмм: { dim: "mass", k: 1 },
  т: { dim: "mass", k: 1000 }, тонна: { dim: "mass", k: 1000 }, тонн: { dim: "mass", k: 1000 },
  г: { dim: "mass", k: 0.001 }, грамм: { dim: "mass", k: 0.001 },
  л: { dim: "volume", k: 1 }, литр: { dim: "volume", k: 1 },
  шт: { dim: "count", k: 1 }, штука: { dim: "count", k: 1 },
};
const unitOf = (u: string) => UNITS[norm(u).replace(/\.$/, "")];

type Notes = { pros: string[]; cons: string[]; missing: string[] };
type Part = { score: number; weight?: number };
const noNotes = (): Notes => ({ pros: [], cons: [], missing: [] });

// ---------- критерии ----------

function categoryCriterion(s: Supplier, q: SearchQuery): { score: number } & Notes {
  const n = noNotes();
  const cats = new Set(s.categories);
  const text = [
    s.name,
    s.description.value ?? "",
    ...s.categories.map(categoryLabel),
  ].join(" ");
  const hay = new Set(stems(text));
  const nameHay = new Set(stems(`${s.name} ${s.categories.join(" ")}`));
  const descFactor = cf(s.description.confidence);

  /** Совпадение слов запроса с карточкой: 0 — нет, без описания и без совпадений — 0.2. */
  const coverage = (query: string): number | null => {
    const qs = stems(query);
    if (qs.length === 0) return null;
    let hit = 0;
    for (const w of qs) {
      if (nameHay.has(w)) hit += 1;
      else if (hay.has(w)) hit += descFactor || 1;
    }
    const ratio = hit / qs.length;
    // Достаточно совпасть по главному слову: уточнения («крафтовая», «для кофе») не обязательны.
    if (ratio > 0) return 0.4 + 0.6 * ratio;
    return s.description.value === null ? 0.2 : 0;
  };

  let structure: number;
  if (q.category.kind === "catalog") {
    const { categoryId, subcategoryId } = q.category;
    const cat = findCategory(categoryId);
    const subIds = new Set(cat?.subcategories.map((x) => x.id) ?? []);
    const hasCat = cats.has(categoryId) || [...cats].some((c) => subIds.has(c));
    const label = subcategoryId
      ? (findSubcategory(categoryId, subcategoryId)?.label ?? subcategoryId)
      : (cat?.label ?? categoryId);
    if (!hasCat) {
      structure = 0;
      const own = s.categories.map(categoryLabel);
      n.cons.push(`Категория поставщика не совпадает с «${label}» (у него: ${list(own)})`);
    } else if (!subcategoryId) {
      structure = 1;
      n.pros.push(`Категория «${cat?.label ?? categoryId}» совпадает с запросом`);
    } else if (cats.has(subcategoryId)) {
      structure = 1;
      n.pros.push(`Подкатегория «${label}» совпадает с запросом`);
    } else if ([...cats].some((c) => subIds.has(c))) {
      structure = 0.3;
      n.cons.push(`Другая подкатегория: нужна «${label}»`);
    } else {
      structure = 0.6;
      n.pros.push(`Категория «${cat?.label ?? categoryId}» совпадает с запросом`);
      n.missing.push(`Подкатегория «${label}» не подтверждена`);
    }
  } else {
    structure = coverage(q.category.text) ?? 0;
    if (structure >= 0.6) n.pros.push(`Карточка поставщика подходит под «${q.category.text}»`);
    else if (structure === 0) n.cons.push(`Ничто не указывает на «${q.category.text}»`);
  }

  const product = q.product.trim();
  let score = structure;
  if (product) {
    const p = coverage(product);
    if (p !== null) {
      const share = SCORING_CONFIG.productShare;
      score = (1 - share) * structure + share * p;
      if (p >= 0.6) n.pros.push(`Товар «${product}» упоминается в карточке`);
      else if (p === 0) n.cons.push(`Товар «${product}» в карточке не найден`);
    }
  }
  return { score: clamp01(score), ...n };
}

type RegionHit = { level: "delivery" | "work" | "address" | "russiaWide"; conf: Confidence | null };

function regionHit(s: Supplier, q: SearchQuery): RegionHit | null {
  const target = q.location.regionId;
  const L = SCORING_CONFIG.regionLevel;
  const hits: { level: RegionHit["level"]; conf: Confidence | null; value: number }[] = [];
  const covers = (entries: string[]) => entries.some((e) => resolveRegionId(e) === target);
  if (present(s.delivery.regions) && covers(s.delivery.regions.value))
    hits.push({ level: "delivery", conf: s.delivery.regions.confidence, value: L.delivery * cf(s.delivery.regions.confidence) });
  if (present(s.workRegions) && covers(s.workRegions.value))
    hits.push({ level: "work", conf: s.workRegions.confidence, value: L.work * cf(s.workRegions.confidence) });
  if (present(s.contacts.address)) {
    const region = findRegion(target);
    const names = q.location.cityId
      ? [findCity(q.location.cityId)?.city.name ?? ""]
      : [region?.name ?? "", ...(region?.cities.map((c) => c.name) ?? [])];
    const addr = norm(s.contacts.address.value);
    if (names.some((x) => x && addr.includes(norm(x))))
      hits.push({ level: "address", conf: s.contacts.address.confidence, value: L.address * cf(s.contacts.address.confidence) });
  }
  if (present(s.delivery.terms) && /по\s+(всей\s+)?(россии|рф)/i.test(s.delivery.terms.value))
    hits.push({ level: "russiaWide", conf: s.delivery.terms.confidence, value: L.russiaWide * cf(s.delivery.terms.confidence) });
  hits.sort((a, b) => b.value - a.value);
  const best = hits[0];
  return best ? { level: best.level, conf: best.conf } : null;
}

function regionCriterion(s: Supplier, q: SearchQuery): { score: number } & Notes {
  const n = noNotes();
  const loc = queryLocationText(q);
  const L = SCORING_CONFIG.regionLevel;
  const hit = regionHit(s, q);
  if (hit) {
    const low = hit.conf === "low";
    const tail = low ? " (данные ненадёжны, проверьте)" : "";
    const phrase = {
      delivery: `Доставка ${loc.to} указана на сайте${tail}`,
      work: `Работает в регионе: ${loc.name}${tail}`,
      address: `Адрес поставщика — ${loc.name}${tail}`,
      russiaWide: `Заявлена доставка по России, но доставка ${loc.to} отдельно не указана — уточните${tail}`,
    }[hit.level];
    n.pros.push(phrase);
    return { score: clamp01(L[hit.level] * cf(hit.conf)), ...n };
  }
  const known = knownRegions(s);
  if (known.length > 0) {
    n.cons.push(`Доставка ${loc.to} не указана (работает: ${list(known)})`);
  } else {
    n.missing.push("Нет данных о регионе работы и доставки");
  }
  return { score: 0, ...n };
}

function filtersCriterion(s: Supplier, q: SearchQuery): { score: number; applicable: boolean } & Notes {
  const n = noNotes();
  const parts: Part[] = [];
  const loc = queryLocationText(q);

  if (q.needCertificates.length > 0) {
    const need = q.needCertificates;
    if (present(s.certificates)) {
      const have = new Map<CertificateType, Confidence | null>();
      for (const c of s.certificates.value) have.set(c.type, s.certificates.confidence);
      const matched = need.filter((t) => have.has(t));
      const lacking = need.filter((t) => !have.has(t));
      parts.push({ score: matched.reduce((a, t) => a + cf(have.get(t) ?? null), 0) / need.length });
      if (matched.length) n.pros.push(`Есть нужные сертификаты: ${list(matched.map((t) => CERTIFICATE_LABELS[t]))}`);
      if (lacking.length) n.cons.push(`Нет сертификата среди указанных: ${list(lacking.map((t) => CERTIFICATE_LABELS[t]))}`);
    } else {
      parts.push({ score: 0 });
      n.missing.push("Нет данных о сертификатах");
    }
  }

  if (q.maxMinOrder) {
    const want = q.maxMinOrder;
    const wantU = unitOf(want.unit);
    if (present(s.minOrder)) {
      const mo = s.minOrder.value;
      const haveU = mo.unit ? unitOf(mo.unit) : undefined;
      if (mo.quantity !== null && haveU && wantU && haveU.dim === wantU.dim) {
        const ok = mo.quantity * haveU.k <= want.value * wantU.k;
        parts.push({ score: ok ? cf(s.minOrder.confidence) : 0 });
        if (ok) n.pros.push(`Минимальный заказ ${mo.quantity} ${mo.unit} укладывается в ${want.value} ${want.unit}`);
        else n.cons.push(`Минимальный заказ ${mo.quantity} ${mo.unit} больше желаемых ${want.value} ${want.unit}`);
      } else {
        parts.push({ score: 0.3 * cf(s.minOrder.confidence) });
        n.missing.push(mo.quantity === null ? "Минимальный заказ указан без числа" : "Единицы минимального заказа не сопоставимы с запросом");
      }
    } else {
      parts.push({ score: 0 });
      n.missing.push("Нет данных о минимальном заказе");
    }
  }

  if (q.needDelivery) {
    const regions = s.delivery.regions;
    if (present(regions)) {
      const ok = regions.value.some((e) => resolveRegionId(e) === q.location.regionId);
      parts.push({ score: ok ? cf(regions.confidence) : 0 });
      if (ok) n.pros.push(`Доставка ${loc.to} указана на сайте`);
      else n.cons.push(`Доставка ${loc.to} не указана (работает: ${list(knownRegions(s))})`);
    } else if (present(s.delivery.terms)) {
      parts.push({ score: 0.5 * cf(s.delivery.terms.confidence) });
      n.pros.push("Условия доставки указаны, регион нужно уточнить");
    } else {
      parts.push({ score: 0 });
      n.missing.push("Нет данных об условиях доставки");
    }
  }

  if (parts.length === 0) return { score: 1, applicable: false, ...n };
  const score = parts.reduce((a, p) => a + p.score, 0) / parts.length;
  return { score: clamp01(score), applicable: true, ...n };
}

/** Поля, по которым считается полнота и надёжность. */
function slots(s: Supplier, q: SearchQuery) {
  const W = SCORING_CONFIG.completenessWeights;
  const mo = s.minOrder.value;
  const pr = s.priceHint.value;
  const anyOf = (xs: { value: unknown; confidence: Confidence | null }[]) => {
    const filled = xs.filter((x) => x.value !== null);
    if (filled.length === 0) return { filled: false, conf: null as Confidence | null };
    const best = filled.reduce((a, b) => (trust(b.confidence) > trust(a.confidence) ? b : a));
    return { filled: true, conf: best.confidence };
  };
  const delivery = anyOf([s.delivery.regions, s.delivery.terms, s.delivery.pickup]);
  const contacts = anyOf([...s.contacts.phones, ...s.contacts.emails, ...s.contacts.messengers]);
  return [
    { key: "website", weight: W.website, filled: present(s.website), conf: s.website.confidence, part: 1, miss: "Нет сайта" },
    { key: "description", weight: W.description, filled: present(s.description), conf: s.description.confidence, part: 1, miss: "Нет описания" },
    { key: "address", weight: W.address, filled: present(s.contacts.address), conf: s.contacts.address.confidence, part: 1, miss: "Нет адреса" },
    { key: "minOrder", weight: W.minOrder, filled: present(s.minOrder), conf: s.minOrder.confidence,
      part: mo && mo.quantity === null ? 0.5 : 1, miss: "Нет данных о минимальном заказе" },
    { key: "price", weight: W.price[q.priceImportance], filled: present(s.priceHint), conf: s.priceHint.confidence,
      part: pr && pr.min === null && pr.max === null ? 0.5 : 1, miss: "Нет данных о цене" },
    { key: "certificates", weight: W.certificates, filled: present(s.certificates), conf: s.certificates.confidence, part: 1, miss: "Нет данных о сертификатах" },
    { key: "delivery", weight: W.delivery, filled: delivery.filled, conf: delivery.conf, part: 1, miss: "Нет данных об условиях доставки" },
    { key: "workRegions", weight: W.workRegions, filled: present(s.workRegions), conf: s.workRegions.confidence, part: 1, miss: "Нет данных о регионе работы" },
    { key: "contacts", weight: 1, filled: contacts.filled, conf: contacts.conf, part: 1, miss: "" },
  ];
}

function completenessCriterion(s: Supplier, q: SearchQuery): { score: number } & Notes {
  const n = noNotes();
  const sl = slots(s, q).filter((x) => x.key !== "contacts");
  const total = sl.reduce((a, x) => a + x.weight, 0);
  const got = sl.reduce((a, x) => a + (x.filled ? x.weight * x.part : 0), 0);
  for (const x of sl) if (!x.filled) n.missing.push(x.miss);
  if (present(s.minOrder) && s.minOrder.value.quantity === null) n.missing.push("Минимальный заказ указан без числа");
  if (present(s.priceHint) && s.priceHint.value.min === null && s.priceHint.value.max === null)
    n.missing.push("Цена указана без чисел (по запросу)");
  const score = clamp01(got / total);
  if (score >= 0.85) n.pros.push("Карточка заполнена полно");
  else if (score <= 0.3) n.cons.push("Карточка почти пустая: данных для решения мало");
  return { score, ...n };
}

function contactsCriterion(s: Supplier): { score: number } & Notes {
  const n = noNotes();
  const P = SCORING_CONFIG.contactParts;
  const best = (xs: { value: unknown; confidence: Confidence | null }[]) =>
    Math.max(0, ...xs.filter(present).map((x) => cf(x.confidence)));
  const phone = best(s.contacts.phones);
  const email = best(s.contacts.emails);
  const messenger = best(s.contacts.messengers);
  const site = best([s.website]);
  const score = clamp01(phone * P.phone + email * P.email + messenger * P.messenger + site * P.website);
  const have: string[] = [];
  if (phone > 0) have.push("телефон");
  if (email > 0) have.push("e-mail");
  if (messenger > 0) have.push("мессенджер");
  if (site > 0) have.push("сайт");
  if (have.length > 0) n.pros.push(`Есть контакты для связи: ${list(have)}`);
  if (phone === 0 && email === 0 && messenger === 0) {
    n.cons.push(site > 0 ? "Нет телефона, почты и мессенджеров — только сайт" : "Нет контактов — связаться не получится");
  }
  if (phone === 0) n.missing.push("Нет телефона");
  if (email === 0) n.missing.push("Нет e-mail");
  return { score, ...n };
}

function confidenceCriterion(s: Supplier, q: SearchQuery): { score: number } & Notes {
  const n = noNotes();
  const sl = slots(s, q);
  // Знаменатель фиксирован: добавление поля никогда не снижает критерий.
  const score = clamp01(sl.reduce((a, x) => a + (x.filled ? trust(x.conf) : 0), 0) / sl.length);
  const lows = sl.filter((x) => x.filled && x.conf === "low").length;
  if (lows > 0) n.cons.push(`Полей с низкой уверенностью: ${lows} — проверьте вручную`);
  if (score >= 0.7) n.pros.push("Данные извлечены с высокой уверенностью");
  return { score, ...n };
}

// ---------- публичный API ----------

export function scoreSupplier(supplier: Supplier, query: SearchQuery): SupplierScore {
  const W = SCORING_CONFIG.weights;
  const cat = categoryCriterion(supplier, query);
  const reg = regionCriterion(supplier, query);
  const fil = filtersCriterion(supplier, query);
  const com = completenessCriterion(supplier, query);
  const con = contactsCriterion(supplier);
  const cnf = confidenceCriterion(supplier, query);

  const mk = (id: CriterionId, score: number, applicable = true): CriterionScore => ({
    id,
    label: SCORING_CONFIG.labels[id],
    weight: W[id],
    score: Math.round(score * 1000) / 1000,
    points: Math.round(score * W[id] * 100) / 100,
    applicable,
  });
  const breakdown = [
    mk("category", cat.score),
    mk("region", reg.score),
    mk("filters", fil.score, fil.applicable),
    mk("contacts", con.score),
    mk("completeness", com.score),
    mk("confidence", cnf.score),
  ];
  const active = breakdown.filter((b) => b.applicable);
  const max = active.reduce((a, b) => a + b.weight, 0);
  const got = active.reduce((a, b) => a + b.score * b.weight, 0);
  const relevanceFactor = SCORING_CONFIG.relevanceFloor + (1 - SCORING_CONFIG.relevanceFloor) * cat.score;
  const all = [cat, reg, fil, con, com, cnf];
  return {
    supplierId: supplier.id,
    total: Math.round((got / max) * relevanceFactor * 100),
    relevanceFactor: Math.round(relevanceFactor * 1000) / 1000,
    breakdown,
    pros: uniq(all.flatMap((x) => x.pros)),
    cons: uniq(all.flatMap((x) => x.cons)),
    missing: uniq(all.flatMap((x) => x.missing)),
  };
}

/**
 * Сортирует по убыванию балла; при равенстве сохраняется исходный порядок.
 * `bestFor` — критерии, по которым поставщик лидирует (ничьи отмечаются у всех;
 * критерий, по которому все равны или у всех ноль, не отмечается).
 */
export function rankSuppliers(list: readonly Supplier[], query: SearchQuery): RankedSupplier[] {
  const scored = list.map((supplier, index) => ({ supplier, index, score: scoreSupplier(supplier, query) }));
  scored.sort((a, b) => b.score.total - a.score.total || a.index - b.index);

  const best = new Map<CriterionId, number>();
  const worst = new Map<CriterionId, number>();
  for (const { score } of scored) {
    for (const b of score.breakdown) {
      if (!b.applicable) continue;
      best.set(b.id, Math.max(best.get(b.id) ?? -Infinity, b.points));
      worst.set(b.id, Math.min(worst.get(b.id) ?? Infinity, b.points));
    }
  }
  return scored.map(({ supplier, score }, i) => ({
    supplier,
    score,
    rank: i + 1,
    bestFor: score.breakdown
      .filter((b) => b.applicable && b.points > 0 && b.points === best.get(b.id) && best.get(b.id) !== worst.get(b.id))
      .map((b) => b.id),
  }));
}
