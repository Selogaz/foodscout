import { SupplierSchema, type Supplier } from "@/domain";
import { digitsOf } from "./grounding";
import { domainOf } from "./candidates";
import { filledCount } from "./extract";

export type Duplicate = { kept: string; removed: string; by: "domain" | "phone" | "email" };

function keys(s: Supplier): { by: Duplicate["by"]; key: string }[] {
  const out: { by: Duplicate["by"]; key: string }[] = [];
  const d = s.website.value ? domainOf(s.website.value) : null;
  if (d) out.push({ by: "domain", key: `d:${d}` });
  for (const p of s.contacts.phones) {
    const digits = p.value ? digitsOf(p.value) : "";
    // Последние 10 цифр: «8 (495)…» и «+7 495…» — один номер. Короткие номера не сравниваем.
    if (digits.length >= 10) out.push({ by: "phone", key: `p:${digits.slice(-10)}` });
  }
  for (const e of s.contacts.emails) {
    // Почтовые домены общего пользования не говорят, что это одна компания — сравниваем адрес целиком
    if (e.value) out.push({ by: "email", key: `e:${e.value.toLowerCase()}` });
  }
  return out;
}

/**
 * Дедуп: один поставщик — одна карточка. Совпадение по домену сайта, телефону или e-mail
 * означает одну компанию (дилерские сайты, зеркала, разные домены одного производства).
 * Остаётся более полная карточка; при равенстве — та, что выше в выдаче (раньше в списке).
 */
export function dedupeSuppliers(list: readonly Supplier[]): { suppliers: Supplier[]; duplicates: Duplicate[] } {
  const kept: Supplier[] = [];
  const index = new Map<string, number>();
  const duplicates: Duplicate[] = [];
  for (const s of list) {
    const ks = keys(s);
    const hit = ks.find((k) => index.has(k.key));
    if (!hit) {
      kept.push(s);
      ks.forEach((k) => index.set(k.key, kept.length - 1));
      continue;
    }
    const i = index.get(hit.key)!;
    const prev = kept[i];
    if (filledCount(s) > filledCount(prev)) {
      kept[i] = s;
      duplicates.push({ kept: s.id, removed: prev.id, by: hit.by });
    } else {
      duplicates.push({ kept: prev.id, removed: s.id, by: hit.by });
    }
    ks.forEach((k) => index.set(k.key, i));
  }
  return { suppliers: kept, duplicates };
}

/** Финальная валидация доменной схемой: карточка, нарушающая инварианты, не уходит в выдачу. */
export function validateSuppliers(list: readonly Supplier[]): { valid: Supplier[]; invalid: { id: string; issues: string }[] } {
  const valid: Supplier[] = [];
  const invalid: { id: string; issues: string }[] = [];
  for (const s of list) {
    const r = SupplierSchema.safeParse(s);
    if (r.success) valid.push(r.data);
    else invalid.push({ id: s.id, issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return { valid, invalid };
}
