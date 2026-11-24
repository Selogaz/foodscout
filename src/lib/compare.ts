import type { RankedSupplier } from "@/domain";

export const MAX_COMPARE = 5;
export const MIN_COMPARE = 2;

/**
 * Индексы лучших значений в строке сравнения. Лучшее подсвечиваем, только если есть что
 * сравнивать: минимум два заполненных значения и не все они равны. Пропуски (null) не участвуют.
 */
export function bestIndexes(values: readonly (number | null)[], better: "max" | "min"): Set<number> {
  const filled = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
  if (filled.length < 2) return new Set();
  const target = better === "max" ? Math.max(...filled.map((x) => x.v)) : Math.min(...filled.map((x) => x.v));
  if (filled.every((x) => x.v === target)) return new Set();
  return new Set(filled.filter((x) => x.v === target).map((x) => x.i));
}

/** Все значения одинаковы (и их хотя бы два) — числа сравнимы между собой, иначе null. */
export function commonOrNull<T>(values: readonly (T | null)[]): T | null {
  const filled = values.filter((v): v is T => v !== null);
  if (filled.length === 0) return null;
  return filled.every((v) => v === filled[0]) ? filled[0] : null;
}

/** Минимальный заказ как число для сравнения: только при одинаковой единице у всех, у кого она указана. */
export function moqNumbers(items: readonly RankedSupplier[]): (number | null)[] {
  const rows = items.map((i) => i.supplier.minOrder.value);
  const unit = commonOrNull(rows.map((m) => (m && m.quantity !== null ? (m.unit ?? "") : null)));
  const filledUnits = rows.filter((m) => m && m.quantity !== null).length;
  if (filledUnits < 2 || unit === null) return rows.map(() => null);
  return rows.map((m) => (m && m.quantity !== null ? m.quantity : null));
}

/** Нижняя граница цены: сравнима только при одинаковой валюте и единице. */
export function priceNumbers(items: readonly RankedSupplier[]): (number | null)[] {
  const rows = items.map((i) => i.supplier.priceHint.value);
  const key = (p: NonNullable<(typeof rows)[number]>) => (p.min !== null && p.currency ? `${p.currency}/${p.unit ?? ""}` : null);
  const common = commonOrNull(rows.map((p) => (p ? key(p) : null)));
  const filled = rows.filter((p) => p && key(p) !== null).length;
  if (filled < 2 || common === null) return rows.map(() => null);
  return rows.map((p) => (p && key(p) !== null ? p.min : null));
}
