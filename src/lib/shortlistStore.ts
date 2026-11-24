import { useSyncExternalStore } from "react";
import { z } from "zod";
import { SearchQuerySchema, SupplierSchema, type RankedSupplier, type SearchQuery } from "@/domain";
import { describeQuery } from "@/lib/supplierFormat";

/**
 * Шортлист в localStorage (серверной БД и авторизации в прототипе нет).
 * Хранится снимок карточки (RankedSupplier) и запрос, по которому поставщик найден:
 * результаты поиска между визитами не сохраняются, а шортлист должен жить без них.
 */

export const SHORTLIST_STORAGE_KEY = "foodscout:shortlist";
export const SHORTLIST_BACKUP_KEY = "foodscout:shortlist:backup";
export const SHORTLIST_VERSION = 1;

export const SHORTLIST_STATUSES = ["new", "write", "quote", "negotiation", "rejected"] as const;
export type ShortlistStatus = (typeof SHORTLIST_STATUSES)[number];

export const STATUS_LABELS: Record<ShortlistStatus, string> = {
  new: "Новый",
  write: "Написать",
  quote: "Запрошено КП",
  negotiation: "В переговорах",
  rejected: "Отказ",
};

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_NOTE_LENGTH = 5000;

export type ShortlistEntry = {
  /** id поставщика (совпадает с item.supplier.id). */
  id: string;
  /** Снимок карточки на момент добавления: данные не обновляются сами. */
  item: RankedSupplier;
  /** Запрос, по которому поставщик найден. */
  query: SearchQuery;
  /** Запрос человеческим языком: «мука пшеничная, Москва». */
  queryLabel: string;
  addedAt: string;
  updatedAt: string;
  status: ShortlistStatus;
  note: string;
  tags: string[];
};

export type ShortlistState = {
  entries: readonly ShortlistEntry[];
  /** false — localStorage недоступен или переполнен: список живёт только в памяти до закрытия вкладки. */
  persistent: boolean;
};

/** Минимальный интерфейс хранилища (подходит localStorage и тестовая подмена). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ---------- валидация ----------

const ScoreSchema = z.custom<RankedSupplier["score"]>((v) => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.total === "number" &&
    Array.isArray(s.pros) &&
    Array.isArray(s.cons) &&
    Array.isArray(s.missing) &&
    Array.isArray(s.breakdown)
  );
});

const EntrySchema = z.object({
  id: z.string().min(1),
  item: z.object({
    supplier: SupplierSchema,
    score: ScoreSchema,
    rank: z.number(),
    bestFor: z.array(z.string()),
  }),
  query: SearchQuerySchema,
  queryLabel: z.string(),
  addedAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(SHORTLIST_STATUSES),
  note: z.string(),
  tags: z.array(z.string()),
});

/** Разбирает сырую строку из хранилища. Битые записи отбрасываются по одной, а не весь список. */
export function parseStored(raw: string | null): { entries: ShortlistEntry[]; unsupported: boolean } {
  if (raw === null) return { entries: [], unsupported: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { entries: [], unsupported: true };
  }
  if (typeof data !== "object" || data === null) return { entries: [], unsupported: true };
  const env = data as { version?: unknown; entries?: unknown };
  // Миграции будущих версий добавляются здесь: версия ниже текущей приводится к текущей.
  if (env.version !== SHORTLIST_VERSION || !Array.isArray(env.entries)) return { entries: [], unsupported: true };
  const entries: ShortlistEntry[] = [];
  for (const e of env.entries) {
    const parsed = EntrySchema.safeParse(e);
    if (parsed.success) entries.push(parsed.data as unknown as ShortlistEntry);
  }
  return { entries, unsupported: false };
}

export function normalizeTag(tag: string): string {
  return tag.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
}

/** Чистит список тегов: пустые убираем, повторы (без учёта регистра) схлопываем, не больше MAX_TAGS. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    const key = n.toLowerCase();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// ---------- стор ----------

export type ShortlistStore = {
  getSnapshot: () => ShortlistState;
  subscribe: (listener: () => void) => () => void;
  add: (item: RankedSupplier, query: SearchQuery) => boolean;
  remove: (id: string) => void;
  /** Вернуть удалённую запись целиком (отмена удаления): заметка и теги сохраняются. */
  restore: (entry: ShortlistEntry) => void;
  has: (id: string) => boolean;
  setStatus: (id: string, status: ShortlistStatus) => void;
  setNote: (id: string, note: string) => void;
  setTags: (id: string, tags: readonly string[]) => void;
  /** Перечитать хранилище (изменение в другой вкладке). */
  reload: () => void;
};

function probe(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    const k = "foodscout:probe";
    storage.setItem(k, "1");
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/**
 * Создаёт стор поверх переданного хранилища (null — только память).
 * Любая ошибка доступа (приватный режим, переполнение, запрет) не ломает работу:
 * стор переходит в режим памяти и выставляет persistent=false.
 */
export function createShortlistStore(storage: StorageLike | null, now: () => Date = () => new Date()): ShortlistStore {
  const listeners = new Set<() => void>();
  let persistent = probe(storage);
  let entries: ShortlistEntry[] = [];

  const readStorage = () => {
    if (!persistent || !storage) return;
    try {
      const raw = storage.getItem(SHORTLIST_STORAGE_KEY);
      const { entries: parsed, unsupported } = parseStored(raw);
      if (unsupported && raw !== null) {
        // Нечитаемые или чужие данные не затираем молча: откладываем копию.
        try {
          storage.setItem(SHORTLIST_BACKUP_KEY, raw);
        } catch {
          /* копия необязательна */
        }
      }
      entries = parsed;
    } catch {
      persistent = false;
    }
  };
  readStorage();

  let state: ShortlistState = { entries, persistent };

  const commit = (next: ShortlistEntry[], write = true) => {
    entries = next;
    if (write && persistent && storage) {
      try {
        storage.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify({ version: SHORTLIST_VERSION, entries }));
      } catch {
        persistent = false;
      }
    }
    state = { entries, persistent };
    listeners.forEach((l) => l());
  };

  const patch = (id: string, change: Partial<Pick<ShortlistEntry, "status" | "note" | "tags">>) => {
    if (!entries.some((e) => e.id === id)) return;
    const stamp = now().toISOString();
    commit(entries.map((e) => (e.id === id ? { ...e, ...change, updatedAt: stamp } : e)));
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(item, query) {
      const id = item.supplier.id;
      if (entries.some((e) => e.id === id)) return false;
      const stamp = now().toISOString();
      const entry: ShortlistEntry = {
        id,
        item,
        query,
        queryLabel: describeQuery(query),
        addedAt: stamp,
        updatedAt: stamp,
        status: "new",
        note: "",
        tags: [],
      };
      commit([...entries, entry]);
      return true;
    },
    remove(id) {
      if (!entries.some((e) => e.id === id)) return;
      commit(entries.filter((e) => e.id !== id));
    },
    restore(entry) {
      if (entries.some((e) => e.id === entry.id)) return;
      commit([...entries, entry]);
    },
    has: (id) => entries.some((e) => e.id === id),
    setStatus: (id, status) => patch(id, { status }),
    setNote: (id, note) => patch(id, { note: note.slice(0, MAX_NOTE_LENGTH) }),
    setTags: (id, tags) => patch(id, { tags: normalizeTags(tags) }),
    reload() {
      readStorage();
      commit(entries, false);
    },
  };
}

// ---------- синглтон и React-хуки (только клиент) ----------

let singleton: ShortlistStore | null = null;

/** Ленивый синглтон: на сервере не создаётся, localStorage читается только в браузере. */
export function getShortlistStore(): ShortlistStore {
  if (!singleton) {
    let storage: StorageLike | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null; // доступ к localStorage запрещён настройками браузера
    }
    singleton = createShortlistStore(storage);
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === SHORTLIST_STORAGE_KEY || e.key === null) singleton?.reload();
      });
    }
  }
  return singleton;
}

/** Только для тестов: сбросить синглтон. */
export function resetShortlistStoreForTests() {
  singleton = null;
}

const SERVER_STATE: ShortlistState = { entries: [], persistent: true };

/**
 * Состояние шортлиста. На сервере и при гидрации отдаёт пустой список (getServerSnapshot),
 * после гидрации React сам перерисует компонент данными из localStorage: рассинхрона разметки нет.
 */
export function useShortlist(): ShortlistState & { store: ShortlistStore } {
  const state = useSyncExternalStore(
    (cb) => getShortlistStore().subscribe(cb),
    () => getShortlistStore().getSnapshot(),
    () => SERVER_STATE,
  );
  return { ...state, store: typeof window === "undefined" ? ({} as ShortlistStore) : getShortlistStore() };
}

const noopSubscribe = () => () => {};
/** false на сервере и при гидрации, true после: чтобы не показывать «пусто», пока данные не прочитаны. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
