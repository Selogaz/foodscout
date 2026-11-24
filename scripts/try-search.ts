/**
 * Ручной прогон пайплайна поиска поставщиков.
 *
 *   npx tsx scripts/try-search.ts                         — три запроса по умолчанию
 *   npx tsx scripts/try-search.ts "сыр для пиццерии, Казань" [--out result.json] [--mock]
 *
 * Запрос — «что ищем, где». С ключом Yandex Cloud в .env.local идёт живой поиск
 * (Yandex Search API + модель AI Studio), без ключа — прогон на моках и фикстурах.
 */
import { writeFileSync } from "node:fs";
import { createLlmProviderFromEnv, MockProvider } from "../src/server/llm";
import { createSearchProviderFromEnv, MockSearchProvider } from "../src/server/search";
import { runSearch, type ProgressEvent, type SearchInput, type SearchRunResult } from "../src/server/pipeline";
import { EXTRACTIONS, fakeFetch, NORMALIZE_ANSWER, SEARCH_HITS, SITES } from "../src/server/pipeline/__fixtures__/sites";
import { rankSuppliers } from "../src/domain";
import { hasYandexKey, loadLocalEnv } from "./env";

loadLocalEnv();

const DEFAULT_QUERIES = ["упаковка для кофе, Москва", "замороженные ягоды оптом, Новосибирск", "сыр для пиццерии, Казань"];

function parseQuery(q: string): SearchInput {
  const i = q.lastIndexOf(",");
  const what = (i > 0 ? q.slice(0, i) : q).trim();
  const where = (i > 0 ? q.slice(i + 1) : "Москва").trim();
  return { category: { kind: "free", text: what }, product: "", location: where };
}

function printEvent(e: ProgressEvent) {
  const t = new Date().toISOString().slice(11, 19);
  switch (e.type) {
    case "stage": return console.log(`[${t}] ${e.message}`);
    case "normalized": return console.log(`[${t}] lr=${e.lr} (${e.place}); фразы: ${e.phrases.join(" | ")}${e.notes.length ? `; ${e.notes.join("; ")}` : ""}`);
    case "candidates": return console.log(`[${t}] кандидатов: ${e.count} — ${e.candidates.map((c) => c.domain).join(", ")}`);
    case "candidate-done": return console.log(`[${t}]   ✓ ${e.domain}: «${e.name}», полей ${e.filledFields}`);
    case "candidate-skipped": return console.log(`[${t}]   – ${e.domain}: ${e.reason}`);
    case "candidate-failed": return console.log(`[${t}]   ✗ ${e.domain}: ${e.error}`);
    case "warning": return console.log(`[${t}]   ! ${e.message}`);
    case "done": return console.log(`[${t}] готово: ${e.suppliers} карточек за ${(e.durationMs / 1000).toFixed(1)} с`);
  }
}

function printResult(r: SearchRunResult) {
  const ranked = rankSuppliers(r.suppliers, r.normalized.query);
  for (const { supplier: s, score, rank } of ranked) {
    const v = <T,>(f: { value: T | null }) => (f.value === null ? "—" : typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value));
    console.log(`\n#${rank} ${s.name} — ${score.total}/100  ${s.website.value}`);
    console.log(`   тел: ${s.contacts.phones.map((p) => p.value).join(", ") || "—"}; почта: ${s.contacts.emails.map((e) => e.value).join(", ") || "—"}`);
    console.log(`   адрес: ${v(s.contacts.address)}`);
    console.log(`   МОЗ: ${s.minOrder.value?.rawText ?? "—"}; цена: ${s.priceHint.value?.rawText ?? "—"}`);
    console.log(`   доставка: ${v(s.delivery.terms)}; регионы: ${v(s.delivery.regions)}; самовывоз: ${v(s.delivery.pickup)}`);
    console.log(`   сертификаты: ${s.certificates.value?.map((c) => c.title ?? c.type).join(", ") ?? "—"}`);
    console.log(`   за: ${score.pros.slice(0, 3).join("; ") || "—"} | нет данных: ${score.missing.slice(0, 3).join("; ") || "—"}`);
  }
  const st = r.stats;
  console.log(
    `\nИтого: поисковых запросов ${st.searchRequests}, кандидатов ${st.candidates}, страниц ${st.pagesFetched}, ` +
      `карточек ${st.suppliers} (отказ ${st.rejected}, сбой ${st.failed}, дублей ${r.duplicates.length}), ` +
      `отброшено непроверенных полей ${st.droppedFields}, LLM-вызовов ${st.llmCalls}, токенов ${st.llmUsage.inputTokens}/${st.llmUsage.outputTokens}, ` +
      `время ${(st.durationMs / 1000).toFixed(1)} с, ≈${st.costRub === null ? "?" : st.costRub.toFixed(2)} ₽`,
  );
}

function deps(forceMock: boolean) {
  if (hasYandexKey() && !forceMock) {
    return { mode: "живой", llm: createLlmProviderFromEnv()!, search: createSearchProviderFromEnv()! };
  }
  const domainOf = (user: string) => Object.keys(EXTRACTIONS).find((d) => user.includes(`URL: https://${d}`))!;
  return {
    mode: "мок (фикстуры, без сети)",
    llm: new MockProvider(({ schemaName, user }) => (schemaName === "normalize_query" ? NORMALIZE_ANSWER : EXTRACTIONS[domainOf(user)])),
    search: new MockSearchProvider(() => SEARCH_HITS),
    fetchImpl: fakeFetch(SITES),
  };
}

async function main() {
  const all = process.argv.slice(2);
  const forceMock = all.includes("--mock");
  const args = all.filter((a) => a !== "--mock");
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  const queries = outIdx >= 0 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args;
  const d = deps(forceMock);
  console.log(`Режим: ${d.mode}${"model" in d.llm ? `, модель ${d.llm.model.replace(/^gpt:\/\/[^/]+\//, "")}` : ""}`);
  const results: { query: string; result: SearchRunResult }[] = [];
  for (const q of queries.length ? queries : DEFAULT_QUERIES) {
    console.log(`\n========== «${q}» ==========`);
    try {
      const result = await runSearch(parseQuery(q), printEvent, d);
      printResult(result);
      results.push({ query: q, result });
    } catch (e) {
      console.log(`ОШИБКА: ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
  if (out) {
    writeFileSync(out, JSON.stringify(results, null, 1));
    console.log(`\nПолный результат: ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
