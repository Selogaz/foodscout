import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/** Ключевой путь прототипа в демо-режиме: ни живого поиска, ни LLM. */
test("чип-пример → выдача → карточка → сравнение → шортлист → заметка → совет → черновик → CSV", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 1. Чип-пример запускает поиск; результаты приходят из записанного прогона.
  await page.getByRole("button", { name: "Мука пшеничная — Краснодар" }).click();
  const results = page.getByRole("region", { name: "Результаты поиска" });
  await expect(results.getByRole("heading", { name: /^Найдено \d+/ })).toBeVisible();
  await expect(results.getByText(/демо/i).first()).toBeVisible();
  const cards = results.getByRole("article");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);

  // 2. Подробная карточка: источник у значений, закрывается.
  const firstName = (await cards.first().getByRole("heading", { level: 3 }).innerText()).trim();
  await cards.first().getByRole("button", { name: /^Подробнее/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(firstName).first()).toBeVisible();
  await expect(sheet.getByRole("link", { name: /источник|http|\.ru|\.com/i }).first()).toBeVisible();
  await sheet.getByRole("button", { name: "Закрыть карточку" }).click();
  await expect(sheet).toBeHidden();

  // 3. Сравнение двух.
  await cards.nth(0).getByLabel("К сравнению").check();
  await cards.nth(1).getByLabel("К сравнению").check();
  await page.getByRole("button", { name: "Сравнить" }).click();
  await expect(page.getByRole("heading", { name: /^Сравнение: 2 поставщика/ })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "К результатам" }).click();

  // 4. В шортлист двух, счётчик в шапке.
  await cards.nth(0).getByRole("button", { name: "В шортлист" }).click();
  await cards.nth(1).getByRole("button", { name: "В шортлист" }).click();
  await expect(page.getByRole("link", { name: /^Шортлист.*2/ })).toBeVisible();

  // 5. Совет «Кому написать первым» на выдаче (детерминированный фолбэк демо).
  await page.getByRole("button", { name: "Подсказать" }).click();
  const order = page.getByRole("list", { name: "Порядок контакта" });
  await expect(order).toBeVisible();
  await expect(order.getByRole("listitem").first()).toBeVisible();
  await expect(order.getByRole("list", { name: "Почему" }).first()).toBeVisible();

  // 6. Шортлист: заметка с автосохранением переживает перезагрузку.
  await page.getByRole("link", { name: /^Шортлист.*2/ }).click();
  await expect(page).toHaveURL(/\/shortlist$/);
  await expect(page.getByRole("heading", { level: 1, name: "Шортлист" })).toBeVisible();
  const noteCard = page.getByRole("article").first();
  const noteName = (await noteCard.getByRole("heading", { level: 3 }).innerText()).trim();
  const note = noteCard.getByRole("textbox", { name: "Заметка" });
  await note.fill("Позвонить в понедельник, уточнить МОЗ");
  await expect(noteCard.getByTestId("note-state")).toHaveText("Сохранено в браузере");
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: noteName }).getByRole("textbox", { name: "Заметка" })).toHaveValue("Позвонить в понедельник, уточнить МОЗ");

  // 7. Совет и черновик запроса из шортлиста.
  await page.getByRole("button", { name: "Подсказать" }).click();
  const draftOpen = page.getByRole("button", { name: /^Черновик запроса:/ }).first();
  await expect(draftOpen).toBeVisible();
  await draftOpen.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Нужный объём").fill("2 т в месяц");
  await dialog.getByRole("button", { name: "Составить черновик" }).click();
  const body = dialog.getByRole("textbox", { name: /Текст письма/ });
  await expect(body).toBeVisible();
  await expect(body).toHaveValue(/2 т в месяц/);
  await expect(dialog.getByText(/без модели/)).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть карточку" }).click();

  // 8. CSV: файл с BOM и кириллицей, заметка внутри.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Скачать CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^foodscout-shortlist-\d{4}-\d{2}-\d{2}\.csv$/);
  const file = await download.path();
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8");
  expect(text).toContain("Название;Статус");
  expect(text).toContain("Позвонить в понедельник");
});
