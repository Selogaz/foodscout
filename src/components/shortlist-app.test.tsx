import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankSuppliers, type SearchQuery } from "@/domain";
import { fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import { getShortlistStore, resetShortlistStoreForTests } from "@/lib/shortlistStore";
import { ShortlistApp } from "./shortlist-app";

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

/** В Node 25 глобальный localStorage без файла сломан и перекрывает jsdom: подставляем свой. */
function stubLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
  resetShortlistStoreForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("страница шортлиста", () => {
  it("пустой шортлист ведёт к поиску", () => {
    render(<ShortlistApp />);
    expect(screen.getByText("В шортлисте пока никого нет.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "К поиску" }).getAttribute("href")).toBe("/");
  });

  it("группирует по статусу, меняет статус и автосохраняет заметку", () => {
    vi.useFakeTimers();
    const store = getShortlistStore();
    store.add(a, query);
    store.add(b, query);
    render(<ShortlistApp />);
    expect(screen.getByRole("heading", { level: 2, name: /Новый/ })).toBeTruthy();

    const article = screen.getByRole("article", { name: fullSupplier.name });
    const select = article.querySelector("select")!;
    fireEvent.change(select, { target: { value: "quote" } });
    expect(store.getSnapshot().entries.find((e) => e.id === a.supplier.id)!.status).toBe("quote");
    expect(screen.getByRole("heading", { level: 2, name: /Запрошено КП/ })).toBeTruthy();

    const note = screen.getAllByRole("textbox", { name: "Заметка" })[0];
    fireEvent.change(note, { target: { value: "Ждём КП до пятницы" } });
    expect(store.getSnapshot().entries.every((e) => e.note === "")).toBe(true);
    act(() => void vi.advanceTimersByTime(700));
    expect(store.getSnapshot().entries.some((e) => e.note === "Ждём КП до пятницы")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("foodscout:shortlist")!).entries.some((e: { note: string }) => e.note === "Ждём КП до пятницы")).toBe(true);
  });

  it("фильтр по тексту скрывает остальных", () => {
    const store = getShortlistStore();
    store.add(a, query);
    store.add(b, query);
    render(<ShortlistApp />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск по шортлисту" }), { target: { value: "несуществующий" } });
    expect(screen.getByText(/Ничего не найдено/)).toBeTruthy();
  });
});
