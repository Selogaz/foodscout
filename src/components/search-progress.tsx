import { CheckIcon, CircleAlertIcon, CircleDashedIcon, Loader2Icon, MinusIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchState } from "@/components/use-supplier-search";
import type { CandidateEvent, StageId } from "@/lib/searchEvents";
import { cn } from "@/lib/utils";

const STEPS: { id: StageId; label: string }[] = [
  { id: "normalize", label: "Разбираем запрос" },
  { id: "search", label: "Ищем сайты поставщиков" },
  { id: "fetch", label: "Читаем страницы и достаём данные" },
  { id: "dedupe", label: "Убираем дубли и считаем баллы" },
];

/** Индекс текущего шага; кеш и демо пропускают весь конвейер. */
function currentStep(stages: StageId[]): number {
  if (stages.includes("cache") || stages.includes("demo")) return STEPS.length;
  let cur = -1;
  for (const s of stages) {
    const i = s === "validate" ? 3 : STEPS.findIndex((x) => x.id === s);
    if (i > cur) cur = i;
  }
  return cur;
}

const CANDIDATE_LABEL: Record<CandidateEvent["status"], string> = {
  found: "найден",
  checking: "проверяем",
  done: "карточка готова",
  skipped: "пропущен",
  failed: "не открылся",
};

function CandidateRow({ c }: { c: CandidateEvent }) {
  const Icon = c.status === "done" ? CheckIcon : c.status === "skipped" ? MinusIcon : c.status === "failed" ? CircleAlertIcon : Loader2Icon;
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          c.status === "done" && "text-emerald-600",
          (c.status === "skipped" || c.status === "failed") && "text-muted-foreground",
          (c.status === "found" || c.status === "checking") && "animate-spin text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="font-medium break-all">{c.name ?? c.domain}</span>
        {c.name && <span className="text-muted-foreground"> · {c.domain}</span>}
        <span className="block text-xs text-muted-foreground">
          {CANDIDATE_LABEL[c.status]}
          {c.status === "done" && c.filledFields != null && ` — заполнено полей: ${c.filledFields}`}
          {c.reason && ` — ${c.reason}`}
        </span>
      </span>
    </li>
  );
}

export function SearchProgress({ state }: { state: SearchState }) {
  const cur = currentStep(state.stages);
  const pct = Math.round(state.progress * 100);
  const detail = state.stage?.detail ?? null;
  const shownCandidates = state.candidates.slice(-8);
  const hidden = state.candidates.length - shownCandidates.length;

  return (
    <section aria-label="Ход поиска" aria-live="polite" className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Ищем поставщиков…</h2>
        <span className="text-sm tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Прогресс поиска">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Живой поиск занимает до минуты: страницы поставщиков читаются по одной.</p>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const status = i < cur ? "done" : i === cur ? "active" : "pending";
          return (
            <li key={s.id} className="flex items-center gap-2 text-sm" data-status={status}>
              {status === "done" ? (
                <CheckIcon aria-hidden className="size-4 text-emerald-600" />
              ) : status === "active" ? (
                <Loader2Icon aria-hidden className="size-4 animate-spin text-primary" />
              ) : (
                <CircleDashedIcon aria-hidden className="size-4 text-muted-foreground" />
              )}
              <span className={cn(status === "pending" && "text-muted-foreground", status === "active" && "font-medium")}>
                {s.label}
                <span className="sr-only"> — {status === "done" ? "готово" : status === "active" ? "идёт" : "ожидает"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {state.stage && (
        <p className="mt-3 text-sm text-muted-foreground">{state.stage.message}</p>
      )}
      {detail && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">
          <p>
            <span className="font-medium">Как мы поняли запрос.</span> Место: {detail.place}.
          </p>
          {detail.phrases.length > 0 && (
            <p className="mt-1 text-muted-foreground">Ищем по фразам: {detail.phrases.map((p) => `«${p}»`).join(", ")}</p>
          )}
          {detail.notes.map((n) => (
            <p key={n} className="mt-1 text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}

      {state.candidates.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Найденные сайты ({state.candidates.length})</h3>
          <ul className="mt-1 divide-y">
            {hidden > 0 && <li className="py-1.5 text-xs text-muted-foreground">…и ещё {hidden} выше</li>}
            {shownCandidates.map((c) => (
              <CandidateRow key={c.domain} c={c} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ))}
      </div>
    </section>
  );
}
