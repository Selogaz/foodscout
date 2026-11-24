import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankSuppliers, type SearchQuery } from "@/domain";
import { fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import { Combobox } from "./combobox";
import { CompareTable } from "./compare-table";
import { SupplierDetail, SupplierDetailSheet } from "./supplier-detail";
import { DemoBanner, EmptyState, ErrorState } from "./search-states";
import { scoreTone, SupplierCard, telHref } from "./supplier-card";
import { IDLE, reduceEvent, type SearchState } from "./use-supplier-search";
import type { ResultEvent } from "@/lib/searchEvents";

afterEach(cleanup);

const query: SearchQuery = {
  category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "flour-cereals" },
  product: "мука",
  location: { regionId: "moscow", cityId: "moscow" },
  needCertificates: ["gost"],
  maxMinOrder: null,
  needDelivery: true,
  priceImportance: "medium",
};

describe("карточка результата", () => {
  const ranked = rankSuppliers([fullSupplier, minimalSupplier], query);

  it("контакты кликабельны, есть балл, причины и источник", () => {
    const item = ranked.find((r) => r.supplier.id === fullSupplier.id)!;
    render(<SupplierCard item={item} selected={false} onToggleCompare={() => {}} onOpen={() => {}} onToggleShortlist={() => {}} />);
    expect(screen.getByRole("link", { name: /\+7 495 000-00-01/ }).getAttribute("href")).toBe("tel:+74950000001");
    expect(screen.getByRole("link", { name: /sales@mukomol\.example\.ru/ }).getAttribute("href")).toBe("mailto:sales@mukomol.example.ru");
    expect(screen.getByRole("link", { name: /^mukomol\.example\.ru$/ }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: /Источник/ })).toBeTruthy();
    expect(screen.getByText(String(item.score.total))).toBeTruthy();
    expect(screen.getAllByLabelText("За").length).toBeGreaterThan(0);
    expect(screen.getByText("ГОСТ")).toBeTruthy();
  });

  it("чекбокс сравнения и шортлист вызывают колбэки", () => {
    const item = ranked[0];
    const cmp = vi.fn();
    const sl = vi.fn();
    render(<SupplierCard item={item} selected={false} onToggleCompare={cmp} onOpen={() => {}} onToggleShortlist={sl} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "К сравнению" }));
    fireEvent.click(screen.getByRole("button", { name: /В шортлист/ }));
    expect(cmp).toHaveBeenCalledWith(item.supplier.id);
    expect(sl).toHaveBeenCalled();
  });

  it("кнопка шортлиста — переключатель: подпись и aria-pressed зависят от состояния", () => {
    const item = ranked[0];
    const toggle = vi.fn();
    const { rerender } = render(<SupplierCard item={item} selected={false} onToggleCompare={() => {}} onOpen={() => {}} onToggleShortlist={toggle} />);
    expect(screen.getByRole("button", { name: "В шортлист" }).getAttribute("aria-pressed")).toBe("false");
    rerender(<SupplierCard item={item} selected={false} onToggleCompare={() => {}} onOpen={() => {}} shortlisted onToggleShortlist={toggle} />);
    const pressed = screen.getByRole("button", { name: "В шортлисте" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pressed);
    expect(toggle).toHaveBeenCalledWith(item.supplier.id);
  });

  it("нет данных — так и написано, а не пусто", () => {
    const item = ranked.find((r) => r.supplier.id === minimalSupplier.id)!;
    render(<SupplierCard item={item} selected={false} onToggleCompare={() => {}} onOpen={() => {}} onToggleShortlist={() => {}} />);
    expect(screen.getAllByText(/нет данных/i).length).toBeGreaterThan(0);
  });

  it("шкала балла и tel:", () => {
    expect(scoreTone(85).tone).toBe("good");
    expect(scoreTone(55).tone).toBe("mid");
    expect(scoreTone(10).tone).toBe("low");
    expect(telHref("8 (800) 555-35-35")).toBe("tel:88005553535");
  });
});

describe("состояния", () => {
  it("демо-баннер, пусто, ошибка с повтором", () => {
    const result = { demo: true, demoMessage: "Ключ не настроен.", results: [] } as unknown as ResultEvent;
    render(<DemoBanner result={result} />);
    expect(screen.getByText("Демо-данные")).toBeTruthy();
    expect(screen.getByText(/Ключ не настроен/)).toBeTruthy();
    cleanup();
    const nearest = {
      demo: true,
      results: [],
      demoInfo: { runId: "x", recordedAt: "2026-11-24T07:21:41.389Z", match: "nearest", shownLabel: "Мука — Краснодар", requestedLabel: "Мука — Сочи" },
    } as unknown as ResultEvent;
    render(<DemoBanner result={nearest} />);
    expect(screen.getByText(/собраны 24 ноября 2026/)).toBeTruthy();
    expect(screen.getByTestId("demo-substitution").textContent).toMatch(/Мука — Сочи.*ближайший.*Мука — Краснодар/);
    cleanup();
    render(<DemoBanner result={{ ...nearest, demoInfo: { ...nearest.demoInfo!, match: "exact" } }} />);
    expect(screen.queryByTestId("demo-substitution")).toBeNull();
    cleanup();
    render(<EmptyState onEdit={() => {}} />);
    expect(screen.getByText(/регион крупнее/)).toBeTruthy();
    cleanup();
    const retry = vi.fn();
    render(<ErrorState message="Слишком много запросов" code="rate_limited" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("поток событий", () => {
  it("накапливает стадии, кандидатов без дублей и предупреждения", () => {
    let s: SearchState = { ...IDLE, status: "loading" };
    s = reduceEvent(s, { type: "stage", stage: "search", message: "x", progress: 0.3 });
    s = reduceEvent(s, { type: "candidate", status: "found", domain: "a.ru", progress: 0.4 });
    s = reduceEvent(s, { type: "candidate", status: "done", domain: "a.ru", name: "А", filledFields: 5, progress: 0.6 });
    s = reduceEvent(s, { type: "warning", message: "w" });
    s = reduceEvent(s, { type: "stage", stage: "normalize", message: "y", progress: 0.1 });
    expect(s.stages).toEqual(["search", "normalize"]);
    expect(s.candidates).toHaveLength(1);
    expect(s.candidates[0].name).toBe("А");
    expect(s.progress).toBe(0.6);
    expect(s.warnings).toEqual(["w"]);
  });
});

describe("комбобокс", () => {
  it("фильтрует, выбирается стрелками и Enter, допускает свободный ввод", () => {
    const onChange = vi.fn();
    render(<Combobox label="Город" value="каз" onChange={onChange} options={[{ id: "1", label: "Казань" }, { id: "2", label: "Омск" }]} />);
    const input = screen.getByRole("combobox", { name: "Город" });
    fireEvent.focus(input);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Казань");
    fireEvent.change(input, { target: { value: "своё" } });
    expect(onChange).toHaveBeenLastCalledWith("своё");
  });
});

describe("детальная карточка и сравнение", () => {
  const q: SearchQuery = query;
  const ranked = rankSuppliers([fullSupplier, minimalSupplier], q);

  it("пустые поля — «нет данных», заполненные — со ссылкой на источник и уверенностью", () => {
    const item = ranked.find((r) => r.supplier.id === minimalSupplier.id)!;
    render(<SupplierDetail item={item} />);
    expect(screen.getAllByText("нет данных").length).toBeGreaterThan(5);
    expect(screen.getByRole("heading", { name: "Почему такой балл" })).toBeTruthy();
  });

  it("источник поля — ссылка на его URL", () => {
    const item = ranked.find((r) => r.supplier.id === fullSupplier.id)!;
    render(<SupplierDetail item={item} />);
    const link = screen.getByRole("link", { name: /Источник \(«минимальный заказ»\)/ });
    expect(link.getAttribute("href")).toBe(fullSupplier.minOrder.sourceUrl);
    expect(screen.getAllByText("высокая").length).toBeGreaterThan(0);
  });

  it("таблица сравнения подсвечивает лучшее и показывает пропуски", () => {
    render(<CompareTable items={ranked} onOpen={() => {}} onRemove={() => {}} />);
    expect(screen.getAllByText("лучшее").length).toBeGreaterThan(0);
    expect(screen.getAllByText("нет данных").length).toBeGreaterThan(3);
    expect(screen.getByRole("button", { name: /Убрать из сравнения: Тест Мукомол/ })).toBeTruthy();
  });

  it("без результатов карточка объясняет, а не падает", () => {
    render(<SupplierDetailSheet open item={null} status="missing" onClose={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/нельзя открыть/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить поиск из ссылки" })).toBeTruthy();
  });
});
