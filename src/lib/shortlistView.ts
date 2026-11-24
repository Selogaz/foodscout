import { SHORTLIST_STATUSES, type ShortlistEntry, type ShortlistStatus } from "@/lib/shortlistStore";

export type ShortlistFilter = {
  /** Поиск по названию, заметке, тегам и запросу (без учёта регистра и ё). */
  text: string;
  status: ShortlistStatus | "all";
};

export const NO_FILTER: ShortlistFilter = { text: "", status: "all" };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Выше балл — выше; при равенстве раньше добавленный — выше (порядок стабилен). */
export function byScore(a: ShortlistEntry, b: ShortlistEntry): number {
  return b.item.score.total - a.item.score.total || a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id);
}

export function filterEntries(entries: readonly ShortlistEntry[], f: ShortlistFilter): ShortlistEntry[] {
  const q = norm(f.text.trim());
  return entries.filter((e) => {
    if (f.status !== "all" && e.status !== f.status) return false;
    if (!q) return true;
    return norm([e.item.supplier.name, e.note, e.tags.join(" "), e.queryLabel].join("\n")).includes(q);
  });
}

export type StatusGroup = { status: ShortlistStatus; entries: ShortlistEntry[] };

/** Группы в порядке воронки (новый → … → отказ), пустые опускаются; внутри групп — по баллу. */
export function groupByStatus(entries: readonly ShortlistEntry[]): StatusGroup[] {
  return SHORTLIST_STATUSES.map((status) => ({ status, entries: entries.filter((e) => e.status === status).sort(byScore) })).filter(
    (g) => g.entries.length > 0,
  );
}

/** Порядок выгрузки совпадает с порядком на странице. */
export function orderForExport(entries: readonly ShortlistEntry[]): ShortlistEntry[] {
  return groupByStatus(entries).flatMap((g) => g.entries);
}
