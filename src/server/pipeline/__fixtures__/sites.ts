/**
 * Вымышленные сайты поставщиков для тестов пайплайна (домены *.example.ru, в названии — «Тест»).
 * Фейковый fetch отдаёт эти страницы, мок-LLM возвращает извлечение по ним.
 */
import type { Extraction } from "../extract";
import type { NormalizeLlmAnswer } from "../normalize";

export const SITES: Record<string, string> = {
  "https://kofepack.example.ru/": `<html><head><title>Тест Кофепак — упаковка для кофе оптом</title><script>var x = "+7 999 000-00-00";</script></head>
<body><header><a href="/kontakty/">Контакты</a> <a href="/dostavka/">Доставка и оплата</a> <a href="/o-kompanii/">О компании</a> <a href="https://vk.com/kofepack">VK</a></header>
<h1>Пакеты для кофе с клапаном от производителя</h1>
<p>Производим дой-паки и пакеты с дегазационным клапаном для обжарщиков кофе.</p>
<p>Минимальная партия — от 1000 шт.</p>
<p>Цена пакета 250 г — от 12 руб./шт.</p>
<footer>Тел.: <a href="tel:+74950001122">+7 (495) 000-11-22</a></footer></body></html>`,
  "https://kofepack.example.ru/kontakty/": `<html><head><title>Контакты — Тест Кофепак</title></head><body>
<h1>Контакты</h1><p>ООО «Тест Кофепак»</p><p>Адрес: г. Москва, ул. Тестовая, д. 5</p>
<p>Телефон: +7 (495) 000-11-22</p><p>E-mail: <a href="mailto:sales@kofepack.example.ru">sales@kofepack.example.ru</a></p>
<p>Telegram: <a href="https://t.me/kofepack_test">@kofepack_test</a></p></body></html>`,
  "https://kofepack.example.ru/dostavka/": `<html><head><title>Доставка</title></head><body>
<p>Доставка по Москве и Московской области собственным транспортом. Отправка транспортными компаниями по всей России.</p>
<p>Самовывоз со склада в Москве.</p></body></html>`,
  "https://kofepack.example.ru/o-kompanii/": `<html><head><title>О компании</title></head><body><p>Работаем с 2015 года. Сертификат ISO 9001.</p></body></html>`,
  "https://kofepack.example.ru/robots.txt": `User-agent: *\nDisallow: /admin/\n`,

  "https://upak-dvor.example.ru/catalog/kofe/": `<html><head><title>Тест Упак-Двор: пакеты для кофе</title></head><body>
<a href="/contacts">Контакты</a>
<h1>Пакеты для кофе оптом</h1><p>Склад в Москве. Звоните: 8 (495) 000-33-44.</p></body></html>`,
  "https://upak-dvor.example.ru/": `<html><head><title>Тест Упак-Двор</title></head><body><p>Упаковка для HoReCa и пищевых производств.</p></body></html>`,
  "https://upak-dvor.example.ru/contacts": `<html><head><title>Контакты</title></head><body><p>Компания «Тест Упак-Двор»</p><p>Тел. 8 (495) 000-33-44</p><p>info@upak-dvor.example.ru</p></body></html>`,

  // Зеркало первого сайта: другой домен, тот же телефон — дубль
  "https://kofepack-msk.example.com/": `<html><head><title>Тест Кофепак Москва</title></head><body><p>Пакеты для кофе. Тел.: +7 (495) 000-11-22</p></body></html>`,
};

export const NORMALIZE_ANSWER: NormalizeLlmAnswer = {
  searchTerms: ["упаковка для кофе", "пакеты для кофе с клапаном"],
  categoryId: "packaging",
  subcategoryId: "film-bags",
  regionId: null,
  cityId: null,
};

const none = {
  description: null, phones: [], emails: [], messengers: [], address: null, minOrder: null, price: null, certificates: [],
  deliveryTerms: null, deliveryRegions: null, pickup: null, workRegions: null, categoryIds: [],
} satisfies Partial<Extraction>;

const K = "https://kofepack.example.ru";

export const EXTRACTIONS: Record<string, Extraction> = {
  "kofepack.example.ru": {
    ...none,
    isSupplier: true,
    notSupplierReason: null,
    companyName: { value: "Тест Кофепак", quote: "ООО «Тест Кофепак»", url: `${K}/kontakty/` },
    description: {
      value: "Производит дой-паки и пакеты с дегазационным клапаном для обжарщиков кофе",
      quote: "Производим дой-паки и пакеты с дегазационным клапаном для обжарщиков кофе.",
      url: `${K}/`,
    },
    phones: [
      { value: "+7 (495) 000-11-22", quote: "Телефон: +7 (495) 000-11-22", url: `${K}/kontakty/` },
      // Выдуманный номер: цитаты нет на страницах — должен быть отброшен
      { value: "+7 (495) 999-99-99", quote: "Отдел продаж: +7 (495) 999-99-99", url: `${K}/kontakty/` },
    ],
    emails: [{ value: "sales@kofepack.example.ru", quote: "E-mail: sales@kofepack.example.ru", url: `${K}/kontakty/` }],
    messengers: [{ kind: "telegram", handle: "@kofepack_test", quote: "Telegram: @kofepack_test", url: `${K}/kontakty/` }],
    address: { value: "г. Москва, ул. Тестовая, д. 5", quote: "Адрес: г. Москва, ул. Тестовая, д. 5", url: `${K}/kontakty/` },
    minOrder: { quantity: 1000, unit: "шт", quote: "Минимальная партия — от 1000 шт.", url: `${K}/` },
    // Число 10 не стоит в цитате — минимальная цена должна обнулиться, максимум не задан → поле уйдёт целиком
    price: { min: 10, max: null, currency: "RUB", unit: "шт", quote: "Цена пакета 250 г — от 12 руб./шт.", url: `${K}/` },
    certificates: [
      { type: "iso", title: "ISO 9001", quote: "Сертификат ISO 9001.", url: `${K}/o-kompanii/` },
      // Выдуманный документ без цитаты на сайте
      { type: "haccp", title: "ХАССП", quote: "Внедрена система ХАССП", url: `${K}/o-kompanii/` },
    ],
    deliveryTerms: {
      value: "Доставка по Москве и Московской области собственным транспортом",
      quote: "Доставка по Москве и Московской области собственным транспортом.",
      url: `${K}/dostavka/`,
    },
    deliveryRegions: {
      values: ["Москва", "Московская область", "Россия", "Казань"],
      quote: "Доставка по Москве и Московской области собственным транспортом. Отправка транспортными компаниями по всей России.",
      url: `${K}/dostavka/`,
    },
    pickup: { value: true, quote: "Самовывоз со склада в Москве.", url: `${K}/dostavka/` },
    categoryIds: ["packaging", "film-bags"],
  },
  "upak-dvor.example.ru": {
    ...none,
    isSupplier: true,
    notSupplierReason: null,
    companyName: { value: "Тест Упак-Двор", quote: "Компания «Тест Упак-Двор»", url: "https://upak-dvor.example.ru/contacts" },
    phones: [{ value: "8 (495) 000-33-44", quote: "Тел. 8 (495) 000-33-44", url: "https://upak-dvor.example.ru/contacts" }],
    emails: [{ value: "info@upak-dvor.example.ru", quote: "info@upak-dvor.example.ru", url: "https://upak-dvor.example.ru/contacts" }],
    categoryIds: ["packaging"],
  },
  "kofepack-msk.example.com": {
    ...none,
    isSupplier: true,
    notSupplierReason: null,
    companyName: { value: "Тест Кофепак Москва", quote: "Тест Кофепак Москва", url: "https://kofepack-msk.example.com/" },
    phones: [{ value: "+7 (495) 000-11-22", quote: "Тел.: +7 (495) 000-11-22", url: "https://kofepack-msk.example.com/" }],
  },
};

export const SEARCH_HITS = [
  { title: "Тест Кофепак — упаковка для кофе", url: "https://kofepack.example.ru/", snippet: "Пакеты с клапаном" },
  { title: "Пакеты для кофе — Авито", url: "https://www.avito.ru/moskva/kofe-pakety", snippet: "Объявления" },
  { title: "Топ-10 поставщиков упаковки для кофе", url: "https://blog.example.org/top-10", snippet: "Подборка" },
  { title: "Тест Упак-Двор: пакеты для кофе", url: "https://upak-dvor.example.ru/catalog/kofe/", snippet: "Склад в Москве" },
  { title: "Тест Кофепак Москва", url: "https://kofepack-msk.example.com/", snippet: "Пакеты для кофе" },
];

/** Фейковый fetch по словарю страниц; `hang` — домены, которые не отвечают (до отмены сигналом). */
export function fakeFetch(pages: Record<string, string>, opts: { hang?: string[] } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const host = new URL(url).hostname;
    if (opts.hang?.includes(host)) {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")));
      });
    }
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    const isRobots = url.endsWith("/robots.txt");
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": isRobots ? "text/plain" : "text/html; charset=utf-8" },
    });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as typeof fetch;
}
