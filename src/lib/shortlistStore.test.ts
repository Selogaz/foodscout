import { beforeEach, describe, expect, it, vi } from "vitest";
import { rankSuppliers, type SearchQuery } from "@/domain";
import { fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import {
  createShortlistStore,
  normalizeTags,
  parseStored,
  SHORTLIST_BACKUP_KEY,
  SHORTLIST_STORAGE_KEY,
  SHORTLIST_VERSION,
  type StorageLike,
} from "./shortlistStore";

const query: SearchQuery = {
  category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
  product: "мука пшеничная",
  location: { regionId: "moscow", cityId: "moscow" },
  needCertificates: [],
  maxMinOrder: null,
  needDelivery: false,
  priceImportance: "medium",
};
const ranked = rankSuppliers([fullSupplier, minimalSupplier], query);
const [a, b] = ranked;

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("стор шортлиста", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("добавляет снимок карточки и запрос, повторное добавление игнорируется", () => {
    const s = createShortlistStore(storage);
    expect(s.add(a, query)).toBe(true);
    expect(s.add(a, query)).toBe(false);
    const [e] = s.getSnapshot().entries;
    expect(s.getSnapshot().entries).toHaveLength(1);
    expect(e.id).toBe(a.supplier.id);
    expect(e.status).toBe("new");
    expect(e.note).toBe("");
    expect(e.item.supplier.name).toBe(a.supplier.name);
    expect(e.query).toEqual(query);
    expect(e.queryLabel).toBe("мука пшеничная, Москва");
    expect(s.has(a.supplier.id)).toBe(true);
  });

  it("переживает «перезагрузку»: новый стор читает то же хранилище", () => {
    const s1 = createShortlistStore(storage);
    s1.add(a, query);
    s1.add(b, query);
    s1.setStatus(a.supplier.id, "quote");
    s1.setNote(a.supplier.id, "Позвонить в понедельник\nспросить про ГОСТ");
    s1.setTags(a.supplier.id, ["мука", "срочно"]);
    const s2 = createShortlistStore(storage);
    const e = s2.getSnapshot().entries.find((x) => x.id === a.supplier.id)!;
    expect(s2.getSnapshot().entries).toHaveLength(2);
    expect(e.status).toBe("quote");
    expect(e.note).toBe("Позвонить в понедельник\nспросить про ГОСТ");
    expect(e.tags).toEqual(["мука", "срочно"]);
    expect(JSON.parse(storage.data.get(SHORTLIST_STORAGE_KEY)!).version).toBe(SHORTLIST_VERSION);
  });

  it("удаление и восстановление записи целиком", () => {
    const s = createShortlistStore(storage);
    s.add(a, query);
    s.setNote(a.supplier.id, "важно");
    const entry = s.getSnapshot().entries[0];
    s.remove(a.supplier.id);
    expect(s.getSnapshot().entries).toHaveLength(0);
    s.restore(entry);
    expect(s.getSnapshot().entries[0].note).toBe("важно");
  });

  it("подписчики уведомляются, снимок меняет ссылку только при изменении", () => {
    const s = createShortlistStore(storage);
    const listener = vi.fn();
    const off = s.subscribe(listener);
    const before = s.getSnapshot();
    expect(s.getSnapshot()).toBe(before);
    s.add(a, query);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot()).not.toBe(before);
    s.setStatus("нет-такого", "write");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    s.remove(a.supplier.id);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("теги: чистка, регистр, лимит", () => {
    expect(normalizeTags([" мука ", "МУКА", "", "  ", "a   b"])).toEqual(["мука", "a b"]);
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `т${i}`))).toHaveLength(10);
  });

  it("битая запись отбрасывается, остальные живут", () => {
    const s1 = createShortlistStore(storage);
    s1.add(a, query);
    s1.add(b, query);
    const env = JSON.parse(storage.data.get(SHORTLIST_STORAGE_KEY)!);
    env.entries[1].item.supplier.name = "";
    storage.data.set(SHORTLIST_STORAGE_KEY, JSON.stringify(env));
    expect(createShortlistStore(storage).getSnapshot().entries.map((e) => e.id)).toEqual([a.supplier.id]);
  });

  it("мусор и чужая версия схемы: пустой список, копия сохраняется, ничего не падает", () => {
    for (const raw of ["{не json", JSON.stringify({ version: 99, entries: [] }), "42"]) {
      const st = memoryStorage({ [SHORTLIST_STORAGE_KEY]: raw });
      const s = createShortlistStore(st);
      expect(s.getSnapshot().entries).toEqual([]);
      expect(s.getSnapshot().persistent).toBe(true);
      expect(st.data.get(SHORTLIST_BACKUP_KEY)).toBe(raw);
    }
    expect(parseStored(null)).toEqual({ entries: [], unsupported: false });
  });

  it("приватный режим: setItem бросает — работа в памяти, persistent=false", () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    const s = createShortlistStore(broken);
    expect(s.getSnapshot().persistent).toBe(false);
    expect(s.add(a, query)).toBe(true);
    s.setStatus(a.supplier.id, "write");
    expect(s.getSnapshot().entries[0].status).toBe("write");
  });

  it("нет хранилища (null) — только память", () => {
    const s = createShortlistStore(null);
    expect(s.getSnapshot().persistent).toBe(false);
    s.add(a, query);
    expect(s.getSnapshot().entries).toHaveLength(1);
  });

  it("переполнение посреди работы: данные в памяти не теряются, флаг сбрасывается", () => {
    let full = false;
    const st: StorageLike = {
      getItem: () => null,
      setItem: () => {
        if (full) throw new Error("quota");
      },
      removeItem: () => {},
    };
    const s = createShortlistStore(st);
    s.add(a, query);
    expect(s.getSnapshot().persistent).toBe(true);
    full = true;
    s.add(b, query);
    expect(s.getSnapshot().persistent).toBe(false);
    expect(s.getSnapshot().entries).toHaveLength(2);
  });

  it("reload подхватывает изменения из другой вкладки", () => {
    const s1 = createShortlistStore(storage);
    const s2 = createShortlistStore(storage);
    s1.add(a, query);
    expect(s2.getSnapshot().entries).toHaveLength(0);
    s2.reload();
    expect(s2.getSnapshot().entries).toHaveLength(1);
  });

  it("длинная заметка обрезается по лимиту", () => {
    const s = createShortlistStore(storage);
    s.add(a, query);
    s.setNote(a.supplier.id, "я".repeat(6000));
    expect(s.getSnapshot().entries[0].note).toHaveLength(5000);
  });
});
