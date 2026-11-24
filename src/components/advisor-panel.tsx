"use client";

import { AlertTriangleIcon, InfoIcon, LoaderCircleIcon, MailPlusIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SearchQuery, Supplier } from "@/domain";
import { FIELD_LABELS, MAX_ADVISE_SUPPLIERS, type Advice, type AdviceItem } from "@/lib/advisor";
import { requestAdvice } from "@/lib/assistClient";
import { cn } from "@/lib/utils";

const FALLBACK_NOTE: Record<NonNullable<Advice["fallbackReason"]>, string> = {
  "demo-mode": "Показан расчёт по баллам без модели: на этом стенде ИИ-подсказки отключены.",
  "no-key": "Показан расчёт по баллам без модели: ключ ИИ не настроен.",
  limit: "Показан расчёт по баллам без модели: суточный лимит подсказок исчерпан.",
  failed: "Модель не ответила, поэтому показан расчёт по баллам: порядок по итоговому баллу, причины — из карточек.",
};

const REGION_BADGE = {
  ok: null,
  unclear: "регион: уточнить",
  mismatch: "регион не совпал",
  unknown: "регион: нет данных",
} as const;

function AdviceRow({ item, onOpen, onDraft }: { item: AdviceItem; onOpen: (id: string) => void; onDraft: (id: string) => void }) {
  const badge = REGION_BADGE[item.region.state];
  return (
    <li className="rounded-lg bg-background p-3 ring-1 ring-foreground/10 sm:p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
            item.position === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          {item.position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold">
              <button type="button" className="text-left hover:underline" onClick={() => onOpen(item.id)}>
                <span className="sr-only">{item.position}-й. </span>
                {item.name}
              </button>
            </h3>
            <span className="text-sm text-muted-foreground tabular-nums">балл {item.score}/100</span>
            {badge && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangleIcon aria-hidden className="size-3" />
                {badge}
              </span>
            )}
          </div>

          <ul className="mt-2 space-y-1.5 text-sm" aria-label="Почему">
            {item.reasons.map((r) => (
              <li key={r.text}>
                {r.text}{" "}
                <span className="text-xs text-muted-foreground">
                  (по полям: {r.fields.map((k) => FIELD_LABELS[k]).join(", ")})
                </span>
              </li>
            ))}
          </ul>

          {item.ask.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium">Уточнить при звонке</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {item.ask.map((a) => (
                  <li key={a.key}>{a.question}</li>
                ))}
              </ul>
            </div>
          )}

          <Button type="button" size="sm" variant="outline" className="mt-3 h-8" onClick={() => onDraft(item.id)} aria-label={`Черновик запроса: ${item.name}`}>
            <MailPlusIcon data-icon="inline-start" />
            Черновик запроса
          </Button>
        </div>
      </div>
    </li>
  );
}

type Props = {
  /** Кого сравниваем (до 8 — берутся первые). */
  suppliers: readonly Supplier[];
  query: SearchQuery;
  /** Подпись источника списка: «из шортлиста» / «из топа выдачи». */
  scopeLabel: string;
  onOpen: (id: string) => void;
  onDraft: (id: string) => void;
  className?: string;
};

/** Блок «Кому написать первым»: запрашивается по кнопке (не тратит модель без нужды), результат — порядок + причины. */
export function AdvisorPanel({ suppliers, query, scopeLabel, onOpen, onDraft, className }: Props) {
  const list = suppliers.slice(0, MAX_ADVISE_SUPPLIERS);
  const sig = `${JSON.stringify(query)}|${list.map((s) => s.id).join(",")}`;
  const [state, setState] = useState<{ sig: string; status: "idle" | "loading" | "done" | "error"; advice?: Advice; error?: string }>({ sig, status: "idle" });
  const ac = useRef<AbortController | null>(null);

  // Состав списка или запрос изменились — прежняя рекомендация устарела.
  const current = state.sig === sig ? state : { sig, status: "idle" as const };
  useEffect(() => () => ac.current?.abort(), []);

  const run = async () => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setState({ sig, status: "loading" });
    try {
      const advice = await requestAdvice({ query, suppliers: [...list] }, c.signal);
      if (!c.signal.aborted) setState({ sig, status: "done", advice });
    } catch (e) {
      if (!c.signal.aborted) setState({ sig, status: "error", error: e instanceof Error ? e.message : "Не удалось получить подсказку." });
    }
  };

  const { status, advice, error } = current;
  return (
    <section aria-labelledby="advisor-title" className={cn("rounded-xl bg-muted/50 p-4 ring-1 ring-foreground/10 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[15rem] flex-1">
          <h2 id="advisor-title" className="flex items-center gap-2 text-lg font-semibold">
            <SparklesIcon aria-hidden className="size-4 text-primary" />
            Кому написать первым
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Порядок контакта {scopeLabel}, {list.length} шт.: с причинами и вопросами для звонка. Опирается только на данные карточек с источниками.
          </p>
        </div>
        <Button type="button" onClick={run} disabled={status === "loading"}>
          {status === "loading" ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <SparklesIcon data-icon="inline-start" />}
          {status === "done" ? "Пересчитать" : "Подсказать"}
        </Button>
      </div>

      {status === "loading" && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Сравниваем карточки…
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {status === "done" && advice && (
        <div className="mt-4 flex flex-col gap-3">
          {advice.regionWarning && (
            <p role="note" className="flex gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{advice.regionWarning}</span>
            </p>
          )}
          <ol className="flex flex-col gap-3" aria-label="Порядок контакта">
            {advice.items.map((it) => (
              <AdviceRow key={it.id} item={it} onOpen={onOpen} onDraft={onDraft} />
            ))}
          </ol>
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {advice.source === "llm"
              ? "Причины сформулировала модель по данным карточек; каждая проверена по полям и числам, регион отмечен автоматически."
              : advice.source === "mixed"
                ? "Часть причин сформулировала модель, остальные — шаблонные: ответ модели по ним не прошёл проверку по карточке."
                : (FALLBACK_NOTE[advice.fallbackReason ?? "failed"])}
          </p>
        </div>
      )}
    </section>
  );
}
