"use client";

import { CheckIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NoData, SourcedList, SourcedValue } from "@/components/sourced-value";
import { scoreTone, telHref } from "@/components/supplier-card";
import { Button } from "@/components/ui/button";
import { CERTIFICATE_LABELS, SCORING_CONFIG, type CriterionId, type RankedSupplier } from "@/domain";
import { bestIndexes, moqNumbers, priceNumbers } from "@/lib/compare";
import { hostOf, MESSENGER_LABELS, regionNames } from "@/lib/supplierFormat";
import { cn } from "@/lib/utils";

type Props = {
  items: RankedSupplier[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
};

const CRITERIA = Object.keys(SCORING_CONFIG.labels) as CriterionId[];

function BestMark() {
  return (
    <span className="mb-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      <CheckIcon aria-hidden className="size-3" />
      лучшее
    </span>
  );
}

function GroupRow({ title, cols }: { title: string; cols: number }) {
  return (
    <tr className="bg-muted/50">
      <th scope="colgroup" colSpan={cols + 1} className="sticky left-0 px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="sticky left-3">{title}</span>
      </th>
    </tr>
  );
}

/** Таблица сравнения: поставщики в колонках, поля и баллы по критериям в строках. */
export function CompareTable({ items, onOpen, onRemove }: Props) {
  const n = items.length;
  const moq = bestIndexes(moqNumbers(items), "min");
  const price = bestIndexes(priceNumbers(items), "min");
  const certs = bestIndexes(items.map((i) => i.supplier.certificates.value?.length ?? null), "max");
  const regions = bestIndexes(items.map((i) => i.supplier.workRegions.value?.length ?? null), "max");
  const totals = bestIndexes(items.map((i) => i.score.total), "max");

  const row = (label: string, cell: (it: RankedSupplier, i: number) => ReactNode, best?: Set<number>) => (
    <tr key={label} className="border-b align-top">
      <th scope="row" className="sticky left-0 z-10 w-32 min-w-32 border-r bg-background px-3 py-2.5 text-left text-sm font-medium sm:w-40 sm:min-w-40">
        {label}
      </th>
      {items.map((it, i) => (
        <td key={it.supplier.id} className={cn("min-w-44 px-3 py-2.5 text-sm", best?.has(i) && "bg-emerald-50 dark:bg-emerald-950/40")}>
          {best?.has(i) && <BestMark />}
          {cell(it, i)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10" data-slot="compare-scroll">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Сравнение поставщиков: поля и баллы по критериям. Лучшие значения отмечены словом «лучшее».</caption>
        <thead>
          <tr className="border-b align-top">
            <th scope="col" className="sticky left-0 z-20 w-32 min-w-32 border-r bg-background px-3 py-3 text-left text-xs font-medium text-muted-foreground sm:w-40 sm:min-w-40">
              Поставщик
            </th>
            {items.map((it) => {
              const tone = scoreTone(it.score.total);
              return (
                <th key={it.supplier.id} scope="col" className="min-w-44 px-3 py-3 text-left font-normal">
                  <div className="flex items-start justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => onOpen(it.supplier.id)}
                      className="text-left text-sm font-semibold underline-offset-2 hover:underline"
                    >
                      {it.supplier.name}
                    </button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Убрать из сравнения: ${it.supplier.name}`} onClick={() => onRemove(it.supplier.id)}>
                      <XIcon />
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #{it.rank} в выдаче · {tone.label}
                  </p>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <GroupRow title="Баллы" cols={n} />
          {row(
            "Итоговый балл",
            (it) => (
              <span className="text-base font-bold tabular-nums">
                {it.score.total}
                <span className="text-xs font-normal text-muted-foreground">/100</span>
              </span>
            ),
            totals,
          )}
          {CRITERIA.map((id) => {
            const cells = items.map((it) => it.score.breakdown.find((b) => b.id === id));
            const applicable = cells.some((c) => c?.applicable);
            if (!applicable) return null;
            const best = bestIndexes(cells.map((c) => (c?.applicable ? c.points : null)), "max");
            return row(
              `${SCORING_CONFIG.labels[id]} (до ${SCORING_CONFIG.weights[id]})`,
              (_, i) => {
                const c = cells[i];
                return c?.applicable ? <span className="tabular-nums">{Math.round(c.points * 10) / 10}</span> : <NoData />;
              },
              best,
            );
          })}

          <GroupRow title="Условия" cols={n} />
          {row("Мин. заказ", (it) => <SourcedValue compact field={it.supplier.minOrder} what="минимальный заказ" render={(v) => v.rawText} />, moq)}
          {row("Цена", (it) => <SourcedValue compact field={it.supplier.priceHint} what="цена" render={(v) => v.rawText} />, price)}
          {row("Доставка", (it) => <SourcedValue compact field={it.supplier.delivery.terms} what="условия доставки" render={(v) => v} />)}
          {row("Самовывоз", (it) => <SourcedValue compact field={it.supplier.delivery.pickup} what="самовывоз" render={(v) => (v ? "Есть" : "Нет")} />)}
          {row("Регионы работы", (it) => <SourcedValue compact field={it.supplier.workRegions} what="регионы работы" render={(v) => regionNames(v)} />, regions)}
          {row(
            "Сертификаты",
            (it) => (
              <SourcedValue compact field={it.supplier.certificates} what="сертификаты" render={(v) => [...new Set(v.map((c) => CERTIFICATE_LABELS[c.type]))].join(", ")} />
            ),
            certs,
          )}

          <GroupRow title="Контакты" cols={n} />
          {row("Сайт", (it) => (
            <SourcedValue
              compact
              field={it.supplier.website}
              what="сайт"
              render={(v) => (
                <a href={v} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">
                  {hostOf(v)}
                </a>
              )}
            />
          ))}
          {row("Телефон", (it) => (
            <SourcedList
              compact
              fields={it.supplier.contacts.phones}
              what="телефон"
              render={(v) => (
                <a href={telHref(v)} className="hover:underline">
                  {v}
                </a>
              )}
            />
          ))}
          {row("E-mail", (it) => (
            <SourcedList
              compact
              fields={it.supplier.contacts.emails}
              what="e-mail"
              render={(v) => (
                <a href={`mailto:${v}`} className="break-all hover:underline">
                  {v}
                </a>
              )}
            />
          ))}
          {row("Мессенджеры", (it) => (
            <SourcedList compact fields={it.supplier.contacts.messengers} what="мессенджер" render={(v) => `${MESSENGER_LABELS[v.kind] ?? v.kind}: ${v.handle}`} />
          ))}
          {row("Адрес", (it) => <SourcedValue compact field={it.supplier.contacts.address} what="адрес" render={(v) => v} />)}
        </tbody>
      </table>
    </div>
  );
}
