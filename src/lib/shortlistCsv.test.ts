import { describe, expect, it } from "vitest";
import { rankSuppliers, type SearchQuery } from "@/domain";
import { fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import { createShortlistStore } from "./shortlistStore";
import { CSV_BOM, CSV_HEADERS, csvFileName, entryToRow, escapeCsvCell, neutralizeFormula, shortlistToCsv, toCsv } from "./shortlistCsv";
import { groupByStatus, filterEntries, NO_FILTER, orderForExport } from "./shortlistView";

const query: SearchQuery = {
  category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
  product: "мука",
  location: { regionId: "moscow", cityId: "moscow" },
  needCertificates: [],
  maxMinOrder: null,
  needDelivery: false,
  priceImportance: "medium",
};
const [a, b] = rankSuppliers([fullSupplier, minimalSupplier], query);

/** Простой разбор CSV для проверки круговой записи (RFC 4180, разделитель «;»). */
function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}

describe("экранирование ячеек CSV", () => {
  it("простое значение остаётся как есть, кириллица не трогается", () => {
    expect(escapeCsvCell("Мука пшеничная")).toBe("Мука пшеничная");
  });
  it("разделитель, кавычки и переносы строк берутся в кавычки, кавычки удваиваются", () => {
    expect(escapeCsvCell("a;b")).toBe('"a;b"');
    expect(escapeCsvCell('Он сказал "да"')).toBe('"Он сказал ""да"""');
    expect(escapeCsvCell("строка1\nстрока2")).toBe('"строка1\nстрока2"');
    expect(escapeCsvCell("строка1\r\nстрока2")).toBe('"строка1\r\nстрока2"');
  });
  it("запятая не требует кавычек при разделителе «;», но требует при «,»", () => {
    expect(escapeCsvCell("a,b")).toBe("a,b");
    expect(escapeCsvCell("a,b", ",")).toBe('"a,b"');
  });
  it("null/undefined — пустая ячейка, число — как есть", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(87)).toBe("87");
  });
  it.each(["=1+1", "+7 495 000-00-01", "-2+3", "@SUM(A1)", "\tтаб", "\rcr", '=HYPERLINK("http://evil","x")'])("формула-инъекция %j нейтрализуется апострофом", (v) => {
    expect(neutralizeFormula(v)).toBe(`'${v}`);
    const cell = escapeCsvCell(v);
    expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("безопасные значения не получают апостроф; знак внутри строки не опасен", () => {
    expect(neutralizeFormula("мука = хлеб")).toBe("мука = хлеб");
    expect(neutralizeFormula("8 495")).toBe("8 495");
    expect(neutralizeFormula("")).toBe("");
  });
  it("опасное значение с кавычками: и апостроф, и экранирование", () => {
    expect(escapeCsvCell('=A1&"x"')).toBe('"\'=A1&""x"""');
  });
});

describe("CSV шортлиста", () => {
  const store = createShortlistStore(null, () => new Date("2026-11-24T09:00:00Z"));
  store.add(a, query);
  store.add(b, query);
  store.setStatus(a.supplier.id, "quote");
  store.setNote(a.supplier.id, '=1+1 и "кавычки"\nвторая строка; с точкой с запятой');
  store.setTags(a.supplier.id, ["срочно", "мука"]);
  const entries = store.getSnapshot().entries;

  it("начинается с BOM, строки разделены CRLF, число колонок одинаково", () => {
    const csv = shortlistToCsv(entries);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toHaveLength(CSV_HEADERS.length);
    expect(rows[0]).toEqual([...CSV_HEADERS]);
  });

  it("поля, статус, заметка и источники выгружаются; заметка с формулой нейтрализована, но читается", () => {
    const rows = parseCsv(shortlistToCsv(entries).slice(1));
    const idx = (h: (typeof CSV_HEADERS)[number]) => CSV_HEADERS.indexOf(h);
    const row = rows.find((r) => r[0] === fullSupplier.name)!;
    expect(row[idx("Статус")]).toBe("Запрошено КП");
    expect(row[idx("Заметка")]).toBe('\'=1+1 и "кавычки"\nвторая строка; с точкой с запятой');
    expect(row[idx("Теги")]).toBe("срочно, мука");
    expect(row[idx("Запрос, по которому найден")]).toBe("мука, Москва");
    expect(row[idx("Телефоны")]).toBe("'+7 495 000-00-01");
    expect(row[idx("Источники")]).toContain("https://mukomol.example.ru/");
    expect(row[idx("Сайт")]).toMatch(/^https:\/\/mukomol/);
    expect(row[idx("Мин. заказ")]).toBe("Минимальная партия — от 500 кг");
  });

  it("нет данных — пустая ячейка, а не выдумка", () => {
    const row = entryToRow(entries.find((e) => e.id === minimalSupplier.id)!);
    expect(row[CSV_HEADERS.indexOf("Мин. заказ")]).toBe("");
    expect(row[CSV_HEADERS.indexOf("Цена")]).toBe("");
    expect(row[CSV_HEADERS.indexOf("Самовывоз")]).toBe("");
  });

  it("пустой шортлист — только заголовок", () => {
    expect(parseCsv(shortlistToCsv([]).slice(1))).toHaveLength(1);
  });

  it("toCsv сохраняет перенос и кириллицу при круговой записи", () => {
    const rows = [["Название", "Заметка"], ["Тест «Ёж»", 'строка 1\nстрока "2"; конец']];
    expect(parseCsv(toCsv(rows))).toEqual([["Название", "Заметка"], ["Тест «Ёж»", 'строка 1\nстрока "2"; конец']]);
  });

  it("имя файла содержит дату", () => {
    expect(csvFileName(new Date("2026-11-24T10:00:00Z"))).toBe("foodscout-shortlist-2026-11-24.csv");
  });
});

describe("вид шортлиста", () => {
  const store = createShortlistStore(null);
  store.add(a, query);
  store.add(b, query);
  store.setStatus(b.supplier.id, "write");
  store.setNote(b.supplier.id, "Позвонить Ёлкину");
  store.setTags(a.supplier.id, ["Мука"]);
  const entries = store.getSnapshot().entries;

  it("группы идут в порядке воронки, внутри — по баллу", () => {
    expect(groupByStatus(entries).map((g) => g.status)).toEqual(["new", "write"]);
    const all = createShortlistStore(null);
    [a, b].forEach((x) => all.add(x, query));
    const sorted = groupByStatus(all.getSnapshot().entries)[0].entries.map((e) => e.item.score.total);
    expect(sorted).toEqual([...sorted].sort((x, y) => y - x));
  });
  it("фильтр по статусу и тексту (регистр, ё/е, заметки, теги)", () => {
    expect(filterEntries(entries, { text: "", status: "write" }).map((e) => e.id)).toEqual([b.supplier.id]);
    expect(filterEntries(entries, { text: "елкину", status: "all" }).map((e) => e.id)).toEqual([b.supplier.id]);
    expect(filterEntries(entries, { text: "мука", status: "all" }).map((e) => e.id).sort()).toEqual([a.supplier.id, b.supplier.id].sort());
    expect(filterEntries(entries, { text: "нет такого", status: "all" })).toEqual([]);
    expect(filterEntries(entries, NO_FILTER)).toHaveLength(2);
  });
  it("порядок выгрузки совпадает с порядком групп", () => {
    expect(orderForExport(entries).map((e) => e.status)).toEqual(["new", "write"]);
  });
});
