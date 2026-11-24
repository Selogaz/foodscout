import { CERTIFICATE_LABELS } from "@/domain";
import { STATUS_LABELS, type ShortlistEntry } from "@/lib/shortlistStore";
import { formatDate, MESSENGER_LABELS, regionNames, SOURCE_TYPE_LABELS } from "@/lib/supplierFormat";

/** BOM нужен Excel, чтобы открыть файл как UTF-8 (иначе кириллица превращается в «РњСѓРєР°»). */
export const CSV_BOM = "﻿";
/** Русскоязычный Excel делит столбцы по «;» (запятая там — десятичный разделитель). */
export const CSV_DELIMITER = ";";
const EOL = "\r\n";

export type CsvCell = string | number | null | undefined;

/**
 * Защита от CSV-инъекции: ячейка, которую Excel/Sheets сочтут формулой
 * (начинается с = + - @, а также с табуляции или CR), получает ведущий апостроф.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Одна ячейка: формулы нейтрализуются, кавычки удваиваются, значения с разделителем/кавычкой/переносом берутся в кавычки. */
export function escapeCsvCell(cell: CsvCell, delimiter: string = CSV_DELIMITER): string {
  if (cell === null || cell === undefined) return "";
  const text = typeof cell === "number" ? String(cell) : neutralizeFormula(cell);
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Строки → текст CSV (CRLF; без BOM, он добавляется при выгрузке). */
export function toCsv(rows: readonly (readonly CsvCell[])[], delimiter: string = CSV_DELIMITER): string {
  return rows.map((r) => r.map((c) => escapeCsvCell(c, delimiter)).join(delimiter)).join(EOL) + EOL;
}

const join = (xs: readonly string[], sep = "\n") => xs.join(sep);
const orEmpty = (v: string | null | undefined) => v ?? "";

export const CSV_HEADERS = [
  "Название",
  "Статус",
  "Балл (0-100)",
  "Теги",
  "Заметка",
  "Запрос, по которому найден",
  "Добавлен",
  "Сайт",
  "Телефоны",
  "E-mail",
  "Мессенджеры",
  "Адрес",
  "Описание",
  "Мин. заказ",
  "Цена",
  "Сертификаты",
  "Условия доставки",
  "Самовывоз",
  "Регионы доставки",
  "Регионы работы",
  "Что совпало",
  "Что не совпало",
  "Нет данных",
  "Источники",
  "Данные собраны",
] as const;

/** Одна строка таблицы для поставщика из шортлиста. Нет данных → пустая ячейка (ничего не выдумываем). */
export function entryToRow(e: ShortlistEntry): CsvCell[] {
  const { supplier: s, score } = e.item;
  const filled = <T,>(list: readonly { value: T | null }[]) => list.flatMap((f) => (f.value === null ? [] : [f.value]));
  return [
    s.name,
    STATUS_LABELS[e.status],
    score.total,
    join(e.tags, ", "),
    e.note,
    e.queryLabel,
    formatDate(e.addedAt),
    orEmpty(s.website.value),
    join(filled(s.contacts.phones)),
    join(filled(s.contacts.emails)),
    join(filled(s.contacts.messengers).map((m) => `${MESSENGER_LABELS[m.kind] ?? m.kind}: ${m.handle}`)),
    orEmpty(s.contacts.address.value),
    orEmpty(s.description.value),
    orEmpty(s.minOrder.value?.rawText),
    orEmpty(s.priceHint.value?.rawText),
    join((s.certificates.value ?? []).map((c) => (c.title ? `${CERTIFICATE_LABELS[c.type]}: ${c.title}` : CERTIFICATE_LABELS[c.type]))),
    orEmpty(s.delivery.terms.value),
    s.delivery.pickup.value === null ? "" : s.delivery.pickup.value ? "Есть" : "Нет",
    s.delivery.regions.value ? regionNames(s.delivery.regions.value) : "",
    s.workRegions.value ? regionNames(s.workRegions.value) : "",
    join(score.pros),
    join(score.cons),
    join(score.missing),
    join(s.sources.map((x) => `${x.url} (${SOURCE_TYPE_LABELS[x.type]})`)),
    formatDate(s.collectedAt),
  ];
}

/** Полный текст CSV шортлиста с BOM: группы по статусу, внутри — по баллу. */
export function shortlistToCsv(entries: readonly ShortlistEntry[]): string {
  return CSV_BOM + toCsv([CSV_HEADERS, ...entries.map(entryToRow)]);
}

export function csvFileName(date: Date = new Date()): string {
  return `foodscout-shortlist-${date.toISOString().slice(0, 10)}.csv`;
}

/** Скачивание в браузере через Blob. */
export function downloadCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
