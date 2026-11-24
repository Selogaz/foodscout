import { SupplierSchema, type SearchQuery, type Supplier } from "@/domain";
import type { SearchRunResult } from "../pipeline/types";

/** Записанный демо-прогон: то, что лежит в src/data/demo/<id>.json. Карточки без скоринга — ранжируются при показе. */
export type DemoRun = {
  id: string;
  /** Подпись запроса для чипа и пометки подмены. */
  label: string;
  /** Когда прогон записан (ISO). */
  recordedAt: string;
  /** Запрос, как его собирает форма: по нему ищется точное совпадение. */
  query: SearchQuery;
  /** Категории справочника, определённые пайплайном (для поиска ближайшего прогона). */
  categoryIds: string[];
  placeLabel: string;
  suppliers: Supplier[];
  warnings: string[];
  stats: { durationMs: number; candidates: number; suppliers: number; costRub: number | null };
  /** Что убрано при санитарии (для прозрачности; в UI не показывается). */
  sanitized: { excluded: { domain: string; reason: string }[]; removed: string[] };
};

/**
 * Явный розничный мусор: домены, исключённые из демо-набора вручную при записи. Логика пайплайна
 * не меняется — это решение о том, что показывать в демо. Причина обязательна.
 */
export const DEMO_EXCLUDED: Record<string, string> = {
  "yagodadagriby.ru": "розничный магазин грибов и ягод (цена за штуку, МОЗ — 1 шт), не поставщик",
  "siberianland.ru": "розничный интернет-магазин (фасовка 500 г, минимальный заказ 1500 ₽)",
  "alenka.ru": "розничный интернет-магазин конфет и шоколада (в разметке — AlenkaRetail), не оптовый поставщик печенья",
  "spb.gostpp.ru": "ИП: в названии фамилия физического лица; склад в Тульской области, к запросу по Петербургу не относится",
};

/** Личные адреса сотрудников, найденные при ручном разборе записей (имя вместо роли: «galina@»). */
export const DEMO_PERSONAL_EMAILS = new Set(["galina@pelmeni.delivery"]);

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Адрес вида «и.фамилия@» или «имя.фамилия@» — личный ящик сотрудника, а не общий ящик компании. */
const GENERIC_LOCALS = new Set([
  "info", "mail", "office", "sale", "sales", "zakaz", "order", "orders", "opt", "market", "marketing", "manager", "msk", "spb", "nsk",
  "operator", "zakup", "zakupadr", "support", "contact", "contacts", "admin", "viton", "buh", "hr", "reklama", "pr", "service", "shop", "kazan",
]);
export function isPersonalEmail(email: string): boolean {
  if (DEMO_PERSONAL_EMAILS.has(email.toLowerCase())) return true;
  const local = email.split("@")[0].toLowerCase();
  if (GENERIC_LOCALS.has(local)) return false;
  // «s.garmotko», «ivan.petrov»: две латинские части через точку, обе без цифр, не слова-роли
  const m = /^([a-z]+)\.([a-z]{3,})$/.exec(local);
  if (!m) return false;
  const words = new Set(["sales", "info", "work", "mail", "order", "office", "opt", "shop", "manager", "operator", "art", "plus", "nsk", "msk", "spb"]);
  return !(words.has(m[1]) || words.has(m[2]));
}

const FIO = /\b[А-ЯЁ][а-яё]+(?:ов|ев|ин|ын|ский|цкий|ская|ова|ева|ина|ына)\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ична|ич)\b/;
const INITIALS = /\b[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s?[А-ЯЁ]\./;
const hasPersonName = (s: string) => FIO.test(s) || INITIALS.test(s);
const isSoleTrader = (name: string) => /^(ИП|индивидуальный предприниматель)\b/i.test(name.trim());
const isMobile = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  const n = d.length === 11 ? d.slice(1) : d;
  return n.length === 10 && n.startsWith("9");
};
const digits = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Очистка карточки от личных данных физлиц. Возвращает копию и список того, что убрано. */
export function sanitizeSupplier(s: Supplier): { supplier: Supplier; removed: string[] } {
  const removed: string[] = [];
  const out: Supplier = structuredClone(s);
  const sole = isSoleTrader(out.name);

  out.contacts.emails = out.contacts.emails.filter((e) => {
    if (e.value && isPersonalEmail(e.value)) {
      removed.push(`${s.id}: личная почта сотрудника`);
      return false;
    }
    return true;
  });

  // Мобильные номера: у юрлица — корпоративный контакт с сайта; у ИП это номер конкретного человека.
  if (sole || hasPersonName(out.name)) {
    out.contacts.phones = out.contacts.phones.filter((p) => {
      if (p.value && isMobile(p.value)) {
        removed.push(`${s.id}: мобильный номер ИП/физлица`);
        return false;
      }
      return true;
    });
  }

  // Мессенджер-«номер», которого нет среди телефонов компании, принадлежит неизвестному человеку.
  const phoneSet = new Set(out.contacts.phones.map((p) => digits(p.value ?? "")));
  out.contacts.messengers = out.contacts.messengers.filter((m) => {
    const h = m.value?.handle ?? "";
    const phoneLike = /^\+?\d[\d\s()-]{8,}$/.test(h);
    if (phoneLike && !phoneSet.has(digits(h))) {
      removed.push(`${s.id}: мессенджер на номер, которого нет среди телефонов компании`);
      return false;
    }
    return true;
  });

  // Адрес с номером квартиры — скорее всего жильё человека, а не офис или склад.
  if (out.contacts.address.value && /(?:^|[\s,])кв(?:\.|артира)?\s*\d+/i.test(out.contacts.address.value)) {
    removed.push(`${s.id}: адрес с квартирой (возможно, жильё физлица)`);
    out.contacts.address = { value: null, sourceUrl: null, confidence: null };
  }

  // ФИО в свободных текстах: поле целиком заменяется на «нет данных».
  const blank = { value: null, sourceUrl: null, confidence: null } as const;
  if (out.description.value && hasPersonName(out.description.value)) {
    removed.push(`${s.id}: ФИО в описании`);
    out.description = { ...blank };
  }
  if (out.contacts.address.value && hasPersonName(out.contacts.address.value)) {
    removed.push(`${s.id}: ФИО в адресе`);
    out.contacts.address = { ...blank };
  }
  if (out.delivery.terms.value && hasPersonName(out.delivery.terms.value)) {
    removed.push(`${s.id}: ФИО в условиях доставки`);
    out.delivery.terms = { ...blank };
  }
  return { supplier: SupplierSchema.parse(out), removed };
}

/** Каждое заполненное значение карточки обязано иметь sourceUrl из sources (схема это уже проверяет — здесь явный отчёт). */
export function countValuesWithoutSource(s: Supplier): number {
  let bad = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      if ("sourceUrl" in o && "confidence" in o && "value" in o) {
        if (o.value !== null && !o.sourceUrl) bad++;
      } else Object.values(o).forEach(walk);
    }
  };
  walk({ website: s.website, description: s.description, contacts: s.contacts, minOrder: s.minOrder, priceHint: s.priceHint,
    certificates: s.certificates, delivery: s.delivery, workRegions: s.workRegions });
  return bad;
}

/** Сырой результат прогона → записываемый демо-прогон + текстовый отчёт санитарии. */
export function buildDemoRun(input: { id: string; label: string; query: SearchQuery; recordedAt: string; run: SearchRunResult }): { demoRun: DemoRun; report: string[] } {
  const { run } = input;
  const excluded: DemoRun["sanitized"]["excluded"] = [];
  const removed: string[] = [];
  const suppliers: Supplier[] = [];
  for (const raw of run.suppliers) {
    const host = raw.website.value ? hostOf(raw.website.value) : "";
    const reason = DEMO_EXCLUDED[host] ?? (isSoleTrader(raw.name) ? "ИП: в названии данные физического лица" : undefined);
    if (reason) {
      excluded.push({ domain: host, reason });
      continue;
    }
    const { supplier, removed: r } = sanitizeSupplier(raw);
    if (countValuesWithoutSource(supplier) > 0) throw new Error(`${supplier.id}: значение без sourceUrl`);
    suppliers.push(supplier);
    removed.push(...r);
  }
  const demoRun: DemoRun = {
    id: input.id,
    label: input.label,
    recordedAt: input.recordedAt,
    query: input.query,
    categoryIds: run.normalized.categoryIds,
    placeLabel: run.normalized.placeLabel,
    suppliers,
    warnings: run.warnings,
    stats: { durationMs: run.stats.durationMs, candidates: run.stats.candidates, suppliers: suppliers.length, costRub: run.stats.costRub === null ? null : Number(run.stats.costRub.toFixed(2)) },
    sanitized: { excluded, removed },
  };
  const report = [...excluded.map((e) => `исключён ${e.domain}: ${e.reason}`), ...removed];
  return { demoRun, report };
}
