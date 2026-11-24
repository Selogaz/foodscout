/**
 * Записанные демо-запросы: id файла `<id>.json`, подпись чипа и то, что вводится в форму.
 * Единый список для скрипта записи (scripts/record-demo.ts) и чипов-примеров в UI: чип всегда
 * ведёт на запрос, для которого есть запись. Модуль без серверных зависимостей.
 */
export type DemoExample = {
  id: string;
  /** Подпись чипа. */
  label: string;
  /** Текст поля «Категория»: название из справочника либо свободный текст. */
  category: string;
  product: string;
  /** Текст поля «Город или регион». */
  location: string;
};

export const DEMO_EXAMPLES: readonly DemoExample[] = [
  { id: "upakovka-kofe-moskva", label: "Упаковка для кофе — Москва", category: "упаковка для кофе", product: "", location: "Москва" },
  { id: "yagody-zamorozka-novosibirsk", label: "Замороженные ягоды — Новосибирск", category: "замороженные ягоды оптом", product: "", location: "Новосибирск" },
  { id: "syr-picceriya-kazan", label: "Сыр для пиццерии — Казань", category: "сыр для пиццерии", product: "", location: "Казань" },
  { id: "muka-krasnodar", label: "Мука пшеничная — Краснодар", category: "Мука, крупы, злаки", product: "мука пшеничная высшего сорта", location: "Краснодар" },
  { id: "pelmeni-spb", label: "Пельмени — Санкт-Петербург", category: "Полуфабрикаты", product: "пельмени", location: "Санкт-Петербург" },
  { id: "pechenye-nn", label: "Печенье — Нижний Новгород", category: "Кондитерские изделия", product: "печенье", location: "Нижний Новгород" },
  { id: "posuda-ekb", label: "Контейнеры для еды — Екатеринбург", category: "Контейнеры и банки", product: "контейнеры для еды навынос", location: "Екатеринбург" },
];
