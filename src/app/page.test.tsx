import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("главная страница", () => {
  it("показывает шапку, форму поиска, примеры и подвал", () => {
    render(<Home />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Поиск поставщиков" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Категория/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Город или регион/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Найти поставщиков" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Мука пшеничная — Москва" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByText("FoodScout")).toBeTruthy();
  });
});
