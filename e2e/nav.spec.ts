import { expect, test } from "@playwright/test";

test("фильтры раскрываются сами, если они есть в ссылке", async ({ page }) => {
  await page.goto("/?ct=мука&lt=Краснодар&moq=500&u=кг&d=1");
  const toggle = page.getByRole("button", { name: /Фильтры/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Максимальный минимальный заказ (МОЗ)")).toBeVisible();
});

test("тосты не закрывают шапку", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Мука пшеничная — Краснодар" }).click();
  await page.getByRole("button", { name: "В шортлист" }).first().click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible();
  // Тост внизу экрана: шапка и навигация остаются доступными.
  const header = (await page.locator("header").first().boundingBox())!;
  const t = (await toast.boundingBox())!;
  const viewportHeight = page.viewportSize()!.height;
  expect(t.y).toBeGreaterThan(viewportHeight / 2);
  expect(t.y + t.height).toBeLessThanOrEqual(viewportHeight);
  expect(t.y).toBeGreaterThan(header.y + header.height);
});
