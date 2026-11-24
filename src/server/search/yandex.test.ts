import { describe, expect, it } from "vitest";
import { REGIONS } from "@/domain";
import { searchLrForLocation } from "./region";
import { parseYandexXml, YandexSearchProvider } from "./yandex";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response><results><grouping>
<group><doc id="1"><url>https://kofepack.example.ru/</url><domain>kofepack.example.ru</domain>
<title><hlword>Упаковка</hlword> для кофе &amp; чая</title>
<headline>Пакеты с клапаном</headline>
<passages><passage>Дой-паки <hlword>оптом</hlword></passage><passage>от 1000 шт.</passage></passages></doc></group>
<group><doc id="2"><url>https://upak.example.ru/a?b=1&amp;c=2</url><title>Упак</title></doc></group>
</grouping></results></response></yandexsearch>`;

describe("Yandex Search API", () => {
  it("разбирает XML: url, заголовок без подсветки, сниппет из headline и пассажей", () => {
    expect(parseYandexXml(XML)).toEqual([
      { url: "https://kofepack.example.ru/", title: "Упаковка для кофе & чая", snippet: "Пакеты с клапаном … Дой-паки оптом … от 1000 шт." },
      { url: "https://upak.example.ru/a?b=1&c=2", title: "Упак", snippet: "" },
    ]);
  });

  it("«ничего не найдено» (код 15) — пустой список, другие ошибки — исключение", () => {
    expect(parseYandexXml('<yandexsearch><response><error code="15">Sorry</error></response></yandexsearch>')).toEqual([]);
    expect(() => parseYandexXml('<yandexsearch><response><error code="55">Limit</error></response></yandexsearch>')).toThrow(/55/);
  });

  it("запрос: POST v2/web/search, Api-Key, region = lr, rawData в base64", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({ rawData: Buffer.from(XML).toString("base64") });
    }) as unknown as typeof fetch;
    const p = new YandexSearchProvider({ apiKey: "key", folderId: "folder", fetchImpl });
    const hits = await p.search("упаковка для кофе оптом москва", 213, { limit: 5 });
    expect(hits).toHaveLength(2);
    const body = JSON.parse(sent!.init.body as string);
    expect(sent!.url).toBe("https://searchapi.api.cloud.yandex.net/v2/web/search");
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Api-Key key");
    expect(body.region).toBe("213");
    expect(body.folderId).toBe("folder");
    expect(body.query.queryText).toBe("упаковка для кофе оптом москва");
    expect(body.groupSpec.groupsOnPage).toBe("5");
  });

  it("без lr параметр region не передаётся; 403 — ошибка доступа", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response('{"message":"Permission denied"}', { status: 403 });
    }) as unknown as typeof fetch;
    const p = new YandexSearchProvider({ apiKey: "key", folderId: "folder", fetchImpl });
    await expect(p.search("q", null)).rejects.toMatchObject({ kind: "auth", status: 403 });
    expect("region" in body).toBe(false);
  });
});

describe("квота 1 запрос/с", () => {
  it("параллельные вызовы идут по очереди с паузой, 429 повторяется один раз", async () => {
    const starts: number[] = [];
    let n = 0;
    const fetchImpl = (async () => {
      starts.push(Date.now());
      n++;
      if (n === 2) return new Response('{"message":"rate quota limit exceed"}', { status: 429 });
      return Response.json({ rawData: Buffer.from(XML).toString("base64") });
    }) as unknown as typeof fetch;
    const p = new YandexSearchProvider({ apiKey: "k", folderId: "f", fetchImpl, minIntervalMs: 30 });
    const res = await Promise.all([p.search("a", 1), p.search("b", 1), p.search("c", 1)]);
    expect(res.every((r) => r.length === 2)).toBe(true);
    expect(n).toBe(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(25);
  });
});

describe("lr по месту из формы", () => {
  it("город → код города, регион → код региона", () => {
    expect(searchLrForLocation({ regionId: "tatarstan", cityId: "kazan" })).toBe(43);
    expect(searchLrForLocation({ regionId: "tatarstan", cityId: null })).toBe(11119);
  });
  it("у каждого региона справочника есть код для поиска (свой или столицы)", () => {
    for (const r of REGIONS) expect(searchLrForLocation({ regionId: r.id, cityId: null })).not.toBeNull();
  });
});
