import { describe, expect, it } from "vitest";
import { field, type Supplier } from "@/domain";
import { fullSupplier, minimalSupplier } from "@/domain/__fixtures__/suppliers";
import { MockProvider } from "../llm/mock";
import { MockSearchProvider } from "../search/mock";
import { fakeFetch, SITES } from "./__fixtures__/sites";
import { findCandidates, rejectHitReason } from "./candidates";
import { dedupeSuppliers, validateSuppliers } from "./dedupe";
import { fetchPages, isAllowedByRobots, parseRobots } from "./fetch-pages";
import { findQuote, numbersIn, paraphraseSupported, phoneInText } from "./grounding";
import { clipText, parseHtml } from "./html";
import { buildSearchPhrases, normalizeQuery } from "./normalize";
import { DEFAULT_LIMITS, type NormalizedQuery, PipelineInputError } from "./types";

describe("normalizeQuery", () => {
  const answer = { searchTerms: ["сыр моцарелла"], categoryId: "ingredients", subcategoryId: "dairy", regionId: null, cityId: null };

  it("свободный текст места, которого нет в словаре, сопоставляется моделью со справочником", async () => {
    const llm = new MockProvider(() => ({ ...answer, regionId: "moscow-oblast", cityId: null }));
    const nq = await normalizeQuery(
      { category: { kind: "free", text: "сыр для пиццерии" }, product: "", location: "Подольск" },
      llm,
    );
    expect(nq.query.location).toEqual({ regionId: "moscow-oblast", cityId: null });
    expect(nq.lr).toBe(1);
    expect(nq.categoryIds).toEqual(["ingredients", "dairy"]);
    expect(nq.notes.join(" ")).toMatch(/Подольск.*Московская область/);
  });

  it("город модели из другого региона отбрасывается, регион остаётся", async () => {
    const llm = new MockProvider(() => ({ ...answer, regionId: "tatarstan", cityId: "novosibirsk" }));
    const nq = await normalizeQuery({ category: { kind: "free", text: "сыр" }, location: "Набережные Челны" }, llm);
    expect(nq.query.location).toEqual({ regionId: "tatarstan", cityId: null });
  });

  it("нераспознанное место — понятная ошибка, а не поиск по всей стране", async () => {
    const llm = new MockProvider(() => answer);
    await expect(
      normalizeQuery({ category: { kind: "free", text: "сыр" }, location: "Атлантида" }, llm),
    ).rejects.toBeInstanceOf(PipelineInputError);
  });

  it("товар пользователя всегда первая формулировка; фразы с местом, без повторов", async () => {
    const llm = new MockProvider(() => ({ ...answer, searchTerms: ["моцарелла", "сыр для пиццы"] }));
    const nq = await normalizeQuery(
      { category: { kind: "catalog", categoryId: "ingredients", subcategoryId: "dairy" }, product: "сыр для пиццерии", location: "Казань" },
      llm,
      { maxPhrases: 4 },
    );
    expect(nq.productPhrase).toBe("сыр для пиццерии");
    expect(nq.searchPhrases).toEqual([
      "сыр для пиццерии оптом казань",
      "сыр для пиццерии производитель казань",
      "моцарелла оптом казань",
      "сыр для пиццы оптом казань",
    ]);
    expect(nq.categoryIds).toEqual(["ingredients", "dairy"]);
  });

  it("buildSearchPhrases ограничивает число фраз", () => {
    expect(buildSearchPhrases(["ягоды"], "Новосибирск", 2)).toEqual(["ягоды оптом новосибирск", "ягоды производитель новосибирск"]);
  });
});

describe("findCandidates", () => {
  const nq = { searchPhrases: ["a", "b"], lr: 65 } as NormalizedQuery;

  it("фильтрует маркетплейсы и подборки, объединяет по домену, ранжирует по числу попаданий", async () => {
    const search = new MockSearchProvider((q) =>
      q === "a"
        ? [
            { title: "X", url: "https://www.one.example.ru/p1", snippet: "" },
            { title: "Ozon", url: "https://www.ozon.ru/category/yagody", snippet: "" },
            { title: "Y", url: "https://two.example.ru/", snippet: "" },
          ]
        : [
            { title: "Z", url: "https://two.example.ru/opt", snippet: "" },
            { title: "Каталог поставщиков ягод", url: "https://cat.example.ru/", snippet: "" },
            { title: "PDF", url: "https://three.example.ru/price.pdf", snippet: "" },
          ],
    );
    const r = await findCandidates(nq, search, { limit: 5 });
    expect(r.candidates.map((c) => c.domain)).toEqual(["two.example.ru", "one.example.ru"]);
    expect(r.candidates[0].hits).toBe(2);
    expect(r.filtered.map((f) => f.reason)).toEqual(["маркетплейс, агрегатор или справочник", "подборка или каталог компаний", "файл, а не страница"]);
    expect(search.calls.every((c) => c.regionLr === 65)).toBe(true);
  });

  it("падение одной фразы — предупреждение; падение всех — ошибка", async () => {
    const half = new MockSearchProvider((q) => {
      if (q === "a") throw new Error("timeout");
      return [{ title: "X", url: "https://one.example.ru/", snippet: "" }];
    });
    const r = await findCandidates(nq, half, { limit: 5 });
    expect(r.candidates).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    const all = new MockSearchProvider(() => {
      throw new Error("HTTP 403");
    });
    await expect(findCandidates(nq, all, { limit: 5 })).rejects.toThrow("HTTP 403");
  });

  it("rejectHitReason пропускает обычные сайты", () => {
    expect(rejectHitReason({ title: "Тест Мукомол", url: "https://mukomol.example.ru/", snippet: "" })).toBeNull();
    expect(rejectHitReason({ title: "a", url: "https://market.yandex.ru/x", snippet: "" })).not.toBeNull();
    expect(rejectHitReason({ title: "a", url: "https://spb.pulscen.ru/x", snippet: "" })).not.toBeNull();
  });
});

describe("fetchPages", () => {
  const cand = { domain: "kofepack.example.ru", url: "https://kofepack.example.ru/", title: "", snippet: "", hits: 1, score: 1 };

  it("загружает главную и служебные страницы, текст без скриптов, ссылки tel:/mailto: в тексте", async () => {
    const { pages } = await fetchPages(cand, DEFAULT_LIMITS, { fetchImpl: fakeFetch(SITES) });
    expect(pages.map((p) => p.kind).sort()).toEqual(["about", "contacts", "delivery", "landing"]);
    const landing = pages.find((p) => p.kind === "landing")!;
    expect(landing.text).not.toMatch(/999 000-00-00/);
    expect(landing.text).toMatch(/Телефоны в ссылках страницы: \+74950001122/);
    expect(pages.find((p) => p.kind === "contacts")!.text).toMatch(/Мессенджеры в ссылках страницы: https:\/\/t\.me\/kofepack_test/);
  });

  it("уважает robots.txt", async () => {
    const sites = { ...SITES, "https://kofepack.example.ru/robots.txt": "User-agent: *\nDisallow: /kontakty/\n" };
    const { pages, errors } = await fetchPages(cand, DEFAULT_LIMITS, { fetchImpl: fakeFetch(sites) });
    expect(pages.some((p) => p.kind === "contacts")).toBe(false);
    expect(errors.join(" ")).toMatch(/robots/);
  });

  it("сайт не отвечает — ошибка кандидата", async () => {
    await expect(
      fetchPages(cand, { ...DEFAULT_LIMITS, pageTimeoutMs: 30 }, { fetchImpl: fakeFetch(SITES, { hang: ["kofepack.example.ru"] }) }),
    ).rejects.toThrow(/не загрузился/);
  });

  it("разбор robots: самое длинное правило, Allow при равенстве, * и $", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.php$\n");
    expect(isAllowedByRobots(rules, "/")).toBe(true);
    expect(isAllowedByRobots(rules, "/private/x")).toBe(false);
    expect(isAllowedByRobots(rules, "/private/open/1")).toBe(true);
    expect(isAllowedByRobots(rules, "/index.php")).toBe(false);
    expect(isAllowedByRobots(rules, "/index.php?x=1")).toBe(true);
  });
});

describe("html и проверка цитат", () => {
  it("parseHtml: текст по блокам, сущности, ссылки абсолютные", () => {
    const p = parseHtml('<title>Т&amp;К</title><body><p>Цена&nbsp;от 12&nbsp;руб.</p><a href="/kontakty">Контакты</a></body>', "https://a.example.ru/x/");
    expect(p.title).toBe("Т&К");
    expect(p.text).toMatch(/Цена от 12 руб\./);
    expect(p.links[0]).toEqual({ href: "https://a.example.ru/kontakty", text: "Контакты" });
  });

  it("clipText сохраняет начало и конец", () => {
    const t = clipText(`${"а".repeat(100)}КОНЕЦ`, 40);
    expect(t.startsWith("а")).toBe(true);
    expect(t.endsWith("КОНЕЦ")).toBe(true);
  });

  it("findQuote: дословно с другими кавычками/тире/пробелами, куски через многоточие, слабое совпадение", () => {
    const page = "ООО «Тест Кофепак»\nМинимальная партия — от 1000 шт.\nЦена от 12 руб./шт.";
    expect(findQuote('ООО "Тест Кофепак"', page)).toBe("exact");
    expect(findQuote("минимальная партия - от 1000  шт.", page)).toBe("exact");
    expect(findQuote("Минимальная партия … от 12 руб.", page)).toBe("exact");
    expect(findQuote("партия Цена Минимальная", page)).toBe("tokens");
    expect(findQuote("Минимальная партия — от 5000 шт.", page)).toBeNull();
  });

  it("phoneInText сравнивает последние 10 цифр; numbersIn понимает «1 200» и «1,5»", () => {
    expect(phoneInText("+7 (495) 000-11-22", "тел. 8 495 000 11 22")).toBe(true);
    expect(phoneInText("+7 (495) 000-11-23", "тел. 8 495 000 11 22")).toBe(false);
    expect(numbersIn("от 1 200 до 1 500,5 руб.")).toEqual([1200, 1500.5]);
  });

  it("paraphraseSupported отличает пересказ от выдумки", () => {
    const q = "Производим дой-паки и пакеты с дегазационным клапаном для обжарщиков кофе.";
    expect(paraphraseSupported("Производит пакеты с клапаном для кофе", q)).toBe(true);
    expect(paraphraseSupported("Крупнейший в России завод полимерной плёнки", q)).toBe(false);
  });
});

describe("dedupe и validate", () => {
  const clone = (s: Supplier, patch: Partial<Supplier>): Supplier => ({ ...structuredClone(s), ...patch });

  it("дубль по домену сайта: остаётся более полная карточка", () => {
    const poor = clone(minimalSupplier, {
      id: "poor",
      website: field("https://mukomol.example.ru", "https://sibsklad.example.com/"),
    });
    const r = dedupeSuppliers([poor, fullSupplier]);
    expect(r.suppliers.map((s) => s.id)).toEqual([fullSupplier.id]);
    expect(r.duplicates).toEqual([{ kept: fullSupplier.id, removed: "poor", by: "domain" }]);
  });

  it("дубль по телефону с разным форматом записи", () => {
    const other = clone(fullSupplier, {
      id: "mirror",
      website: field("https://mukomol-mirror.example.ru", "https://mukomol.example.ru/"),
      contacts: { ...fullSupplier.contacts, phones: [field("8 (495) 000 00 01", "https://mukomol.example.ru/contacts")], emails: [] },
    });
    const r = dedupeSuppliers([fullSupplier, other]);
    expect(r.suppliers).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ kept: fullSupplier.id, removed: "mirror", by: "phone" });
  });

  it("разные компании остаются", () => {
    expect(dedupeSuppliers([fullSupplier, minimalSupplier]).suppliers).toHaveLength(2);
  });

  it("validate отсекает карточку, у поля которой источник не из sources", () => {
    const bad = clone(minimalSupplier, { id: "bad", description: field("x", "https://elsewhere.example.ru/") });
    const r = validateSuppliers([fullSupplier, bad]);
    expect(r.valid.map((s) => s.id)).toEqual([fullSupplier.id]);
    expect(r.invalid[0].id).toBe("bad");
  });
});
