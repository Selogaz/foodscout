import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("главная страница", () => {
  it("показывает шапку, форму поиска, примеры и подвал", () => {
    render(<Home />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Поиск поставщиков" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Категория/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Город или регион/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Найти поставщиков" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Мука пшеничная — Краснодар" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByText("FoodScout")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Шортлист" }).getAttribute("href")).toBe("/shortlist");
  });
});
