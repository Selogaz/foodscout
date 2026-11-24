import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Все экраны на 1280 и 390 px: axe (без critical/serious), горизонтальное переполнение,
 * тач-цели на мобильном. Скриншоты и сводка axe пишутся, только если задан E2E_OUT_DIR.
 */
const OUT = process.env.E2E_OUT_DIR;
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 800, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
] as const;

type Row = { screen: string; viewport: string; critical: number; serious: number; moderate: number; minor: number; ids: string[] };
const rows: Row[] = [];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function inspect(page: Page, screen: string, vp: (typeof VIEWPORTS)[number], opts: { fullPage?: boolean } = {}) {
  await settle(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const count = (impact: string) => axe.violations.filter((v) => v.impact === impact).length;
  rows.push({
    screen,
    viewport: vp.name,
    critical: count("critical"),
    serious: count("serious"),
    moderate: count("moderate"),
    minor: count("minor"),
    ids: axe.violations.map((v) => `${v.id}(${v.impact})`),
  });
  const bad = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), `axe ${screen} ${vp.name}`).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `горизонтальная прокрутка на «${screen}» ${vp.name}`).toBeLessThanOrEqual(0);

  if (vp.mobile) {
    // Тач-цели ≥ 44 px по высоте для кнопок, ссылок и полей вне прокручиваемых таблиц и скрытых панелей.
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const els = document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=option], summary");
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || el.closest("[hidden],[aria-hidden=true],.sr-only")) return;
        if (el.matches("input[type=checkbox]")) {
          const box = el.closest("label")?.getBoundingClientRect();
          if (box && box.height >= 44) return;
        }
        if (el.closest("a[href].inline-text") ) return;
        if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}» ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      return out;
    });
    expect(small, `тач-цели < 44px на «${screen}»`).toEqual([]);
  }

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `${screen}-${vp.name}.png`), fullPage: opts.fullPage ?? true });
  }
}

test.afterAll(() => {
  if (OUT && rows.length) writeFileSync(path.join(OUT, "axe-report.json"), JSON.stringify(rows, null, 2));
});

for (const vp of VIEWPORTS) {
  test.describe(`экраны ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile });

    test("поиск, выдача, карточка, сравнение", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Найти поставщиков" })).toBeVisible();
      await inspect(page, "01-главная", vp);

      await page.getByRole("button", { name: /Фильтры/ }).click();
      await inspect(page, "02-фильтры", vp);

      await page.getByRole("button", { name: "Найти поставщиков" }).click();
      await expect(page.getByText(/Укажите|Выберите|Заполните/).first()).toBeVisible();
      await inspect(page, "03-ошибки-формы", vp);

      await page.getByRole("button", { name: "Сыр для пиццерии — Казань" }).click();
      const results = page.getByRole("region", { name: "Результаты поиска" });
      await expect(results.getByRole("heading", { name: /^Найдено/ })).toBeVisible();
      await inspect(page, "04-выдача", vp);

      const cards = results.getByRole("article");
      await cards.nth(0).getByLabel("К сравнению").check();
      await cards.nth(1).getByLabel("К сравнению").check();
      await inspect(page, "05-выдача-панель-сравнения", vp, { fullPage: false });

      await page.getByRole("button", { name: "Подсказать" }).click();
      await expect(page.getByRole("list", { name: "Порядок контакта" })).toBeVisible();
      await inspect(page, "06-совет", vp);

      await cards.nth(0).getByRole("button", { name: /^Подробнее/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await inspect(page, "07-карточка", vp, { fullPage: false });
      await page.getByRole("dialog").getByRole("button", { name: "Черновик запроса" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Составить черновик" }).click();
      await expect(page.getByRole("dialog").getByRole("textbox", { name: /Текст письма/ })).toBeVisible();
      await inspect(page, "08-черновик", vp, { fullPage: false });
      await page.getByRole("dialog").getByRole("button", { name: "Закрыть карточку" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();

      await page.getByRole("button", { name: "Сравнить" }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await inspect(page, "09-сравнение", vp);
    });

    test("шортлист и пустые состояния", async ({ page }) => {
      await page.goto("/shortlist");
      await expect(page.getByText("В шортлисте пока никого нет.")).toBeVisible();
      await inspect(page, "10-шортлист-пусто", vp);

      await page.goto("/?ct=zzz&lt=Казань");
      await page.getByRole("button", { name: "Найти поставщиков" }).click();
      await expect(page.getByRole("region", { name: "Результаты поиска" })).toBeVisible();
      await inspect(page, "11-выдача-свободный-запрос", vp);

      await page.getByRole("button", { name: "Печенье — Нижний Новгород" }).click();
      const cards = page.getByRole("region", { name: "Результаты поиска" }).getByRole("article");
      await expect(cards.first()).toBeVisible();
      for (const i of [0, 1, 2]) await cards.nth(i).getByRole("button", { name: "В шортлист" }).click();
      await page.getByRole("link", { name: /^Шортлист/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Шортлист" })).toBeVisible();
      await expect(page.getByRole("article").first()).toBeVisible();
      await inspect(page, "12-шортлист", vp);

      await page.getByRole("button", { name: "Подсказать" }).click();
      await expect(page.getByRole("list", { name: "Порядок контакта" })).toBeVisible();
      await inspect(page, "13-шортлист-совет", vp);
    });

    test("ссылка на карточку без результатов и страница 404", async ({ page }) => {
      await page.goto("/?s=net-takogo&ct=мука&lt=Краснодар");
      await expect(page.getByText("Эту карточку сейчас нельзя открыть.")).toBeVisible();
      await inspect(page, "14-карточка-по-ссылке", vp, { fullPage: false });
      const missing = await page.goto("/net-takoy-stranicy");
      expect(missing?.status()).toBe(404);
      await inspect(page, "15-404", vp);
    });
  });
}
