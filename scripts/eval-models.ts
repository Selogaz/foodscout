/**
 * Мини-эвал моделей извлечения.
 *
 *   npx tsx scripts/eval-models.ts collect <bundles.json>
 *     — ищет поставщиков по нескольким запросам, загружает страницы 10 сайтов и замораживает
 *       их в файл: все модели получают один и тот же вход.
 *   npx tsx scripts/eval-models.ts run <bundles.json> <gold.json> <out.json> <model> [model…]
 *     — прогоняет извлечение каждой моделью и считает метрики против ручной разметки.
 *   npx tsx scripts/eval-models.ts regrade <bundles.json> <gold.json> <results.json> <out.json>
 *     — пересчитывает метрики по сохранённым ответам моделей (после правки проверки цитат), без вызовов LLM.
 *
 * Разметка gold.json: { [domain]: { isSupplier, companyName, phones[], emails[], address,
 * minOrderQuantity, hasMinOrder, hasPrice, hasDeliveryTerms } } — значения, которые человек
 * нашёл на этих страницах (null — на страницах этого нет).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { aiStudioModelUri, llmCostRub, LlmError, OpenAiCompatibleProvider } from "../src/server/llm";
import { createSearchProviderFromEnv, searchLrForLocation } from "../src/server/search";
import {
  buildSupplier,
  DEFAULT_LIMITS,
  ExtractionSchema,
  EXTRACT_SYSTEM_PROMPT,
  fetchPages,
  findCandidates,
  type Candidate,
  type Extraction,
  type FetchedPage,
  type NormalizedQuery,
} from "../src/server/pipeline";
import { buildExtractUserPrompt } from "../src/server/pipeline/prompts/extract";
import { CATEGORY_LIST_TEXT } from "../src/server/pipeline/catalog-text";
import { digitsOf, findQuote, normText } from "../src/server/pipeline/grounding";
import { SearchQuerySchema } from "../src/domain";
import { hasYandexKey, loadLocalEnv } from "./env";

loadLocalEnv();

type Bundle = { candidate: Candidate; nq: NormalizedQuery; pages: FetchedPage[] };
/** null в поле разметки — «неоднозначно, не оцениваем». */
type Gold = {
  isSupplier: boolean;
  companyName: string | null;
  phones: string[];
  emails: string[];
  /** Любой из адресов считается верным; null — не оцениваем. */
  address: string[] | null;
  hasMinOrder: boolean | null;
  minOrderQuantity: number | null;
  hasPrice: boolean | null;
  hasDeliveryTerms: boolean | null;
};

const COLLECT_QUERIES = [
  { phrase: "мука пшеничная оптом производитель Москва", regionId: "moscow", cityId: "moscow", product: "мука пшеничная", cat: ["ingredients", "flour-cereals"] },
  { phrase: "специи оптом Екатеринбург", regionId: "sverdlovsk-oblast", cityId: "yekaterinburg", product: "специи", cat: ["spices", "spices-herbs"] },
  { phrase: "одноразовая посуда оптом Санкт-Петербург", regionId: "saint-petersburg", cityId: "saint-petersburg", product: "одноразовая посуда", cat: ["packaging", "disposable-tableware"] },
  { phrase: "мясные полуфабрикаты производитель Краснодар", regionId: "krasnodar-krai", cityId: "krasnodar", product: "мясные полуфабрикаты", cat: ["finished-food", "semi-finished"] },
] as const;

async function collect(out: string) {
  const search = createSearchProviderFromEnv();
  if (!search) throw new Error("Нет YANDEX_API_KEY/YANDEX_FOLDER_ID");
  const bundles: Bundle[] = [];
  for (const q of COLLECT_QUERIES) {
    const query = SearchQuerySchema.parse({
      category: { kind: "catalog", categoryId: q.cat[0], subcategoryId: q.cat[1] },
      product: q.product,
      location: { regionId: q.regionId, cityId: q.cityId },
    });
    const nq: NormalizedQuery = {
      query, lr: searchLrForLocation(query.location), placeLabel: q.phrase.split(" ").pop()!, productPhrase: q.product,
      categoryIds: [...q.cat], searchPhrases: [q.phrase], notes: [],
    };
    const { candidates } = await findCandidates(nq, search, { limit: 4 });
    let taken = 0;
    for (const c of candidates) {
      if (taken >= 3 || bundles.length >= 10) break;
      try {
        const { pages } = await fetchPages(c, DEFAULT_LIMITS);
        bundles.push({ candidate: c, nq, pages });
        taken++;
        console.log(`+ ${c.domain} (${pages.length} стр.)`);
      } catch (e) {
        console.log(`- ${c.domain}: ${(e as Error).message}`);
      }
    }
  }
  writeFileSync(out, JSON.stringify(bundles, null, 1));
  console.log(`Сохранено ${bundles.length} сайтов → ${out}`);
}

// ---------- метрики ----------

const phoneKey = (p: string) => digitsOf(p).slice(-10);
const addrMatch = (a: string, b: string) => {
  const wa = new Set(normText(a).split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 2));
  const wb = normText(b).split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 2);
  return wb.length > 0 && wb.filter((w) => wa.has(w)).length / wb.length >= 0.6;
};

type FieldScore = { correct: number; total: number };
const add = (s: FieldScore, ok: boolean) => {
  s.total++;
  if (ok) s.correct++;
};

/** Сколько значений модели не подтверждается страницами (до фильтра) — доля «выдуманного». */
function rawValues(ex: Extraction): { path: string; quote: string; url: string; value: string }[] {
  const out: { path: string; quote: string; url: string; value: string }[] = [];
  const push = (path: string, f: { quote: string; url: string } | null, value: unknown) => {
    if (f) out.push({ path, quote: f.quote, url: f.url, value: String(value) });
  };
  push("companyName", ex.companyName, ex.companyName?.value);
  push("description", ex.description, ex.description?.value);
  ex.phones.forEach((p, i) => push(`phones.${i}`, p, p.value));
  ex.emails.forEach((p, i) => push(`emails.${i}`, p, p.value));
  ex.messengers.forEach((p, i) => push(`messengers.${i}`, p, p.handle));
  push("address", ex.address, ex.address?.value);
  push("minOrder", ex.minOrder, ex.minOrder?.quantity);
  push("price", ex.price, `${ex.price?.min}-${ex.price?.max}`);
  ex.certificates.forEach((p, i) => push(`certificates.${i}`, p, p.type));
  push("deliveryTerms", ex.deliveryTerms, ex.deliveryTerms?.value);
  push("deliveryRegions", ex.deliveryRegions, ex.deliveryRegions?.values.join(","));
  push("pickup", ex.pickup, ex.pickup?.value);
  push("workRegions", ex.workRegions, ex.workRegions?.values.join(","));
  return out;
}

/** Накопитель метрик одной модели; одна и та же логика для живого прогона и перепроверки. */
class Grader {
  fields: Record<string, FieldScore> = {};
  jsonOk = 0;
  firstTry = 0;
  raw = 0;
  quoteNotFound = 0;
  unsupported = 0;
  wrongVsGold = 0;
  perSite: Record<string, unknown>[] = [];
  constructor(private readonly gold: Record<string, Gold>) {}
  private f = (k: string) => (this.fields[k] ??= { correct: 0, total: 0 });

  site(b: Bundle, ex: Extraction, meta: { ms: number; attempts: number }) {
    const g = this.gold[b.candidate.domain];
    this.jsonOk++;
    if (meta.attempts === 1) this.firstTry++;
    const vals = rawValues(ex);
    this.raw += vals.length;
    const allText = b.pages.map((p) => `${p.title}\n${p.text}`).join("\n");
    const notFound = vals.filter((v) => !findQuote(v.quote, allText));
    this.quoteNotFound += notFound.length;
    const { supplier, dropped } = buildSupplier(ex, { candidate: b.candidate, pages: b.pages, nq: b.nq, collectedAt: new Date().toISOString() });
    // Отброшенные значения: цитата не найдена или значение не следует из цитаты/страницы
    this.unsupported += dropped.length;
    const f = this.f;
    if (g) {
      add(f("isSupplier"), ex.isSupplier === g.isSupplier);
      if (g.isSupplier && ex.isSupplier) {
        // Контакты: все выданные значения есть на сайте, и хотя бы одно найдено
        const mp = new Set(ex.phones.map((p) => phoneKey(p.value)));
        const gp = new Set(g.phones.map(phoneKey));
        add(f("phones"), gp.size === 0 ? mp.size === 0 : mp.size > 0 && [...mp].every((p) => gp.has(p)));
        const me = new Set(ex.emails.map((e) => e.value.toLowerCase().trim()));
        const ge = new Set(g.emails.map((e) => e.toLowerCase()));
        add(f("emails"), ge.size === 0 ? me.size === 0 : me.size > 0 && [...me].every((e) => ge.has(e)));
        if (g.address !== null) add(f("address"), !!ex.address && g.address.some((a) => addrMatch(ex.address!.value, a)));
        if (g.companyName !== null) add(f("companyName"), !!ex.companyName && addrMatch(ex.companyName.value, g.companyName));
        if (g.hasMinOrder !== null)
          add(f("minOrder"), g.hasMinOrder ? !!ex.minOrder && (g.minOrderQuantity === null || ex.minOrder.quantity === g.minOrderQuantity) : !ex.minOrder);
        if (g.hasPrice !== null) add(f("price"), g.hasPrice === !!ex.price);
        if (g.hasDeliveryTerms !== null) add(f("deliveryTerms"), g.hasDeliveryTerms === !!ex.deliveryTerms);
        // Значения, которых нет на сайте по разметке: лишние телефоны/почта, МОЗ/цена при «нет»
        this.wrongVsGold += [...mp].filter((p) => !gp.has(p)).length + [...me].filter((e) => !ge.has(e)).length
          + (g.hasMinOrder === false && ex.minOrder ? 1 : 0) + (g.hasPrice === false && ex.price ? 1 : 0);
      }
    }
    this.perSite.push({
      domain: b.candidate.domain, ms: meta.ms, attempts: meta.attempts, isSupplier: ex.isSupplier, values: vals.length,
      notFound: notFound.map((v) => `${v.path}: ${v.value} ← «${v.quote.slice(0, 80)}»`),
      dropped: dropped.map((d) => `${d.path}: ${d.reason} [${d.value.slice(0, 120)}]`),
      raw: ex,
      kept: { phones: supplier.contacts.phones.map((p) => p.value), emails: supplier.contacts.emails.map((e) => e.value), minOrder: supplier.minOrder.value?.rawText ?? null, price: supplier.priceHint.value?.rawText ?? null },
    });
    return { values: vals.length, notFound: notFound.length, dropped: dropped.length };
  }

  summary(extra: Record<string, unknown>) {
    const total = Object.values(this.fields).reduce((a, s) => a + s.total, 0);
    const correct = Object.values(this.fields).reduce((a, s) => a + s.correct, 0);
    return {
      ...extra,
      jsonValid: this.jsonOk, jsonFirstTry: this.firstTry,
      fieldAccuracy: Number((correct / Math.max(1, total)).toFixed(3)),
      fields: Object.fromEntries(Object.entries(this.fields).map(([k, s]) => [k, `${s.correct}/${s.total}`])),
      rawValues: this.raw,
      quoteNotFound: this.quoteNotFound,
      unsupportedValues: this.unsupported,
      unsupportedShare: Number((this.unsupported / Math.max(1, this.raw)).toFixed(3)),
      wrongVsGold: this.wrongVsGold,
      perSite: this.perSite,
    };
  }
}

async function run(bundlesPath: string, goldPath: string, outPath: string, models: string[]) {
  const bundles = JSON.parse(readFileSync(bundlesPath, "utf8")) as Bundle[];
  const gold = JSON.parse(readFileSync(goldPath, "utf8")) as Record<string, Gold>;
  if (!hasYandexKey()) throw new Error("Нет ключа");
  const report: Record<string, unknown>[] = [];
  for (const model of models) {
    const mode = (process.env.LLM_STRUCTURED_MODE as "json_schema" | "json_object") || "json_schema";
    const reasoning = (process.env.EVAL_REASONING as "none" | "low" | undefined) ?? "none";
    const llm = new OpenAiCompatibleProvider({
      baseUrl: "https://ai.api.cloud.yandex.net/v1",
      apiKey: process.env.YANDEX_API_KEY!,
      model: aiStudioModelUri(model, process.env.YANDEX_FOLDER_ID!),
      authScheme: "Api-Key",
      project: process.env.YANDEX_FOLDER_ID,
      structuredMode: mode,
      reasoningEffort: reasoning,
      timeoutMs: 120_000,
    });
    const grader = new Grader(gold);
    let tin = 0, tout = 0, ms = 0, errors = 0;
    for (const b of bundles) {
      const t0 = Date.now();
      try {
        const r = await llm.extractStructured({
          schemaName: "supplier_extraction",
          schema: ExtractionSchema,
          system: EXTRACT_SYSTEM_PROMPT,
          user: buildExtractUserPrompt({ productPhrase: b.nq.productPhrase, placeLabel: b.nq.placeLabel, categoryList: CATEGORY_LIST_TEXT, pages: b.pages }),
          maxTokens: 2500,
        });
        const dt = Date.now() - t0;
        ms += dt;
        tin += r.usage.inputTokens;
        tout += r.usage.outputTokens;
        const g = grader.site(b, r.data, { ms: dt, attempts: r.attempts });
        console.log(`${model} ${b.candidate.domain}: ${dt} мс, значений ${g.values}, цитата не найдена ${g.notFound}, отброшено ${g.dropped}`);
      } catch (e) {
        ms += Date.now() - t0;
        errors++;
        if (e instanceof LlmError && e.usage) {
          tin += e.usage.inputTokens;
          tout += e.usage.outputTokens;
        }
        grader.perSite.push({ domain: b.candidate.domain, error: (e as Error).message.slice(0, 300) });
        console.log(`${model} ${b.candidate.domain}: ОШИБКА ${(e as Error).message.slice(0, 200)}`);
      }
    }
    const usage = { inputTokens: tin, outputTokens: tout };
    const summary = grader.summary({ model, mode, reasoning, sites: bundles.length, errors, avgMs: Math.round(ms / bundles.length), usage, costRub: llmCostRub(model, usage) });
    report.push(summary);
    console.log(JSON.stringify({ ...summary, perSite: undefined }, null, 1));
  }
  writeFileSync(outPath, JSON.stringify(report, null, 1));
}

/** Перепроверка сохранённых ответов моделей текущим кодом проверки цитат — без вызовов модели. */
function regrade(bundlesPath: string, goldPath: string, resultsPath: string, outPath: string) {
  const bundles = new Map((JSON.parse(readFileSync(bundlesPath, "utf8")) as Bundle[]).map((b) => [b.candidate.domain, b]));
  const gold = JSON.parse(readFileSync(goldPath, "utf8")) as Record<string, Gold>;
  const prev = JSON.parse(readFileSync(resultsPath, "utf8")) as (Record<string, unknown> & { perSite: { domain: string; raw?: Extraction; ms?: number; attempts?: number; error?: string }[] })[];
  const report = prev.map((m) => {
    const grader = new Grader(gold);
    for (const s of m.perSite) {
      const b = bundles.get(s.domain)!;
      if (s.raw) grader.site(b, s.raw, { ms: s.ms ?? 0, attempts: s.attempts ?? 1 });
      else grader.perSite.push(s);
    }
    const { model, mode, reasoning, sites, errors, avgMs, usage, costRub } = m;
    const summary = grader.summary({ model, mode, reasoning, sites, errors, avgMs, usage, costRub });
    console.log(JSON.stringify({ ...summary, perSite: undefined }));
    return summary;
  });
  writeFileSync(outPath, JSON.stringify(report, null, 1));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "collect") await collect(args[0]);
  else if (cmd === "run") await run(args[0], args[1], args[2], args.slice(3));
  else if (cmd === "regrade") regrade(args[0], args[1], args[2], args[3]);
  else console.log("usage: collect <bundles.json> | run <bundles.json> <gold.json> <out.json> <model…>");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
