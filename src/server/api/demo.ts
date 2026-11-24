import { findCategory, findSubcategory, rankSuppliers, type RankedSupplier, type SearchQuery } from "@/domain";
import { DEMO_RUNS } from "@/data/demo";
import type { DemoInfo } from "@/lib/searchEvents";
import { locationLabel } from "../search/region";
import type { DemoRun } from "./demo-sanitize";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
/** Слова запроса, обрезанные до 5 букв: грубая основа, чтобы «ягоды» и «ягод» совпадали. */
const stems = (s: string) => new Set(norm(s).split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));

function categoryText(q: SearchQuery): string {
  if (q.category.kind === "free") return q.category.text;
  const cat = findCategory(q.category.categoryId)?.label ?? "";
  const sub = q.category.subcategoryId ? (findSubcategory(q.category.categoryId, q.category.subcategoryId)?.label ?? "") : "";
  return [cat, sub].filter(Boolean).join(" ");
}

/** Подпись запроса для пометки подмены: «Мука, крупы, злаки, мука пшеничная — Краснодар». */
export function queryLabel(q: SearchQuery): string {
  const cat = q.category.kind === "free" ? q.category.text : (q.category.subcategoryId && findSubcategory(q.category.categoryId, q.category.subcategoryId)?.label) || findCategory(q.category.categoryId)?.label || "";
  return `${[cat, q.product].filter(Boolean).join(", ")} — ${locationLabel(q.location)}`;
}

function sameCategory(a: SearchQuery["category"], b: SearchQuery["category"]): boolean {
  if (a.kind === "free" && b.kind === "free") return norm(a.text) === norm(b.text);
  if (a.kind === "catalog" && b.kind === "catalog") return a.categoryId === b.categoryId && (a.subcategoryId ?? "") === (b.subcategoryId ?? "");
  return false;
}

/** Близость запроса и записанного прогона: категория важнее места; 0 — ничего общего. */
export function similarity(q: SearchQuery, run: DemoRun): number {
  let score = 0;
  const topId = q.category.kind === "catalog" ? q.category.categoryId : null;
  if (topId) {
    if (run.query.category.kind === "catalog" && run.query.category.categoryId === topId) score += 3;
    else if (run.categoryIds.includes(topId)) score += 3;
    if (q.category.kind === "catalog" && q.category.subcategoryId) {
      const sub = q.category.subcategoryId;
      if ((run.query.category.kind === "catalog" && run.query.category.subcategoryId === sub) || run.categoryIds.includes(sub)) score += 2;
    }
  }
  const mine = stems(`${categoryText(q)} ${q.product}`);
  const theirs = stems(`${categoryText(run.query)} ${run.query.product} ${run.label}`);
  let common = 0;
  for (const w of mine) if (theirs.has(w)) common++;
  score += Math.min(common, 3) * 2;
  if (run.query.location.cityId && run.query.location.cityId === q.location.cityId) score += 3;
  else if (run.query.location.regionId === q.location.regionId) score += 2;
  return score;
}

/** Меньше этого — ничего похожего, показываем прогон по умолчанию. */
const NEAREST_MIN_SCORE = 3;

export function matchDemoRun(q: SearchQuery, runs: readonly DemoRun[] = DEMO_RUNS): { run: DemoRun; match: DemoInfo["match"] } {
  const exact = runs.find(
    (r) => sameCategory(r.query.category, q.category) && norm(r.query.product) === norm(q.product) && (r.query.location.cityId ?? r.query.location.regionId) === (q.location.cityId ?? q.location.regionId),
  );
  if (exact) return { run: exact, match: "exact" };
  let best: DemoRun | null = null;
  let bestScore = 0;
  for (const r of runs) {
    const s = similarity(q, r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  if (best && bestScore >= NEAREST_MIN_SCORE) return { run: best, match: "nearest" };
  return { run: runs[0], match: "default" };
}

/** Запрос точно совпал с записанным прогоном (чип-пример): его можно отдать мгновенно, без живого поиска. */
export function isRecordedExample(q: SearchQuery, runs: readonly DemoRun[] = DEMO_RUNS): boolean {
  return matchDemoRun(q, runs).match === "exact";
}

/**
 * Демо-прогон для запроса: точное совпадение → ближайший по категории и региону → прогон по умолчанию.
 * Карточки — настоящие записанные данные; скоринг считается заново под фильтры пользователя
 * (сертификаты, МОЗ, доставка, важность цены), категорию и место берём из записи.
 */
export function pickDemoRun(query: SearchQuery): { results: RankedSupplier[]; warnings: string[]; query: SearchQuery; info: DemoInfo; stats: DemoRun["stats"] } {
  const { run, match } = matchDemoRun(query);
  const shown: SearchQuery = {
    ...run.query,
    needCertificates: query.needCertificates,
    maxMinOrder: query.maxMinOrder,
    needDelivery: query.needDelivery,
    priceImportance: query.priceImportance,
  };
  const date = run.recordedAt.slice(0, 10).split("-").reverse().join(".");
  return {
    results: rankSuppliers(run.suppliers, shown),
    warnings: [...run.warnings, `Данные записаны ${date} с реальных сайтов поставщиков; цены и контакты могли измениться — проверяйте на сайте по ссылке у каждого значения.`],
    query: shown,
    stats: run.stats,
    info: { runId: run.id, recordedAt: run.recordedAt, match, shownLabel: queryLabel(run.query), requestedLabel: queryLabel(query) },
  };
}
