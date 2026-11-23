import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("главная страница", () => {
  it("показывает шапку, форму и подвал", () => {
    render(<Home />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Поиск поставщиков" })).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByText("FoodScout")).toBeTruthy();
  });
});
