/**
 * Запись демо-набора из реальных прогонов пайплайна.
 *
 *   npx tsx scripts/record-demo.ts <id>              — живой прогон одного запроса из DEMO_EXAMPLES (≈23 ₽)
 *   npx tsx scripts/record-demo.ts <id> --from-raw   — пересобрать src/data/demo/<id>.json из сырого прогона (без сети и денег)
 *   npx tsx scripts/record-demo.ts <id> --from-file f.json [--index N]
 *                                                    — взять уже записанный прогон (формат try-search --out)
 *   npx tsx scripts/record-demo.ts --list            — список id и статус записи
 *
 * Сырой результат лежит в RAW_DIR (по умолчанию <системный tmp>/foodscout-demo-raw) — в репозиторий
 * он не попадает. В src/data/demo пишется очищенная версия (см. src/server/api/demo-sanitize.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQuery, EMPTY_FORM } from "../src/lib/formState";
import { DEMO_EXAMPLES } from "../src/data/demo/examples";
import { createLlmProviderFromEnv } from "../src/server/llm";
import { createSearchProviderFromEnv } from "../src/server/search";
import { runSearch, type ProgressEvent, type SearchRunResult } from "../src/server/pipeline";
import { buildDemoRun } from "../src/server/api/demo-sanitize";
import { hasYandexKey, loadLocalEnv } from "./env";

loadLocalEnv();

const RAW_DIR = process.env.RAW_DIR ?? join(tmpdir(), "foodscout-demo-raw");
const OUT_DIR = "src/data/demo";

function log(e: ProgressEvent) {
  const t = new Date().toISOString().slice(11, 19);
  if (e.type === "stage") console.log(`[${t}] ${e.message}`);
  else if (e.type === "candidate-done") console.log(`[${t}]   ok ${e.domain}: «${e.name}», полей ${e.filledFields}`);
  else if (e.type === "candidate-skipped") console.log(`[${t}]   -- ${e.domain}: ${e.reason}`);
  else if (e.type === "candidate-failed") console.log(`[${t}]   !! ${e.domain}: ${e.error}`);
  else if (e.type === "done") console.log(`[${t}] готово: ${e.suppliers} карточек за ${(e.durationMs / 1000).toFixed(1)} с`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const ex of DEMO_EXAMPLES) console.log(`${existsSync(join(OUT_DIR, `${ex.id}.json`)) ? "записан " : "нет     "} ${ex.id}  ${ex.label}`);
    return;
  }
  const id = args[0];
  const ex = DEMO_EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`Укажите id из DEMO_EXAMPLES (--list). Получено: ${id ?? "ничего"}`);

  const built = buildQuery({ ...EMPTY_FORM, category: ex.category, product: ex.product, location: ex.location });
  if (!built.ok) throw new Error(`Запрос примера не собирается: ${JSON.stringify(built.errors)}`);

  mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = join(RAW_DIR, `${ex.id}.json`);
  let run: SearchRunResult;
  let recordedAt: string;
  const fileIdx = args.indexOf("--from-file");
  if (args.includes("--from-raw")) {
    ({ run, recordedAt } = JSON.parse(readFileSync(rawPath, "utf8")));
  } else if (fileIdx >= 0) {
    const src = JSON.parse(readFileSync(args[fileIdx + 1], "utf8")) as { query: string; result: SearchRunResult }[];
    const i = args.indexOf("--index");
    const entry = src[i >= 0 ? Number(args[i + 1]) : 0];
    run = entry.result;
    recordedAt = args.includes("--recorded-at") ? args[args.indexOf("--recorded-at") + 1] : "2026-11-24T00:00:00.000Z";
    console.log(`Взят готовый прогон «${entry.query}» (${run.suppliers.length} карточек), сеть не используется`);
    writeFileSync(rawPath, JSON.stringify({ recordedAt, run }, null, 1));
  } else {
    if (!hasYandexKey()) throw new Error("Нет ключа Yandex в .env.local — живая запись невозможна");
    const llm = createLlmProviderFromEnv()!;
    const search = createSearchProviderFromEnv()!;
    console.log(`Живой прогон «${ex.label}» (≈23 ₽)`);
    run = await runSearch(built.query, log, { llm, search });
    recordedAt = new Date().toISOString();
    writeFileSync(rawPath, JSON.stringify({ recordedAt, run }, null, 1));
  }

  const { demoRun, report } = buildDemoRun({ id: ex.id, label: ex.label, query: built.query, recordedAt, run });
  writeFileSync(join(OUT_DIR, `${ex.id}.json`), JSON.stringify(demoRun, null, 1) + "\n");
  console.log(`\n${ex.id}: карточек ${demoRun.suppliers.length} (сырых ${run.suppliers.length}), запись ${recordedAt}`);
  for (const line of report) console.log(`  санитария: ${line}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
