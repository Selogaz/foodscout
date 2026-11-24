"use client";

import { BookmarkCheckIcon, CheckIcon, GlobeIcon, InfoIcon, LinkIcon, MailIcon, MapPinIcon, PhoneIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CERTIFICATE_LABELS, findRegion, type RankedSupplier } from "@/domain";
import { hostOf } from "@/lib/supplierFormat";
import { cn } from "@/lib/utils";

export type ScoreTone = "good" | "mid" | "low";

/** Цветовая шкала балла: от 70 — хорошо, 40–69 — средне, ниже — слабо. Цвет не единственный носитель смысла: рядом подпись. */
export function scoreTone(total: number): { tone: ScoreTone; label: string } {
  if (total >= 70) return { tone: "good", label: "хорошее совпадение" };
  if (total >= 40) return { tone: "mid", label: "частичное совпадение" };
  return { tone: "low", label: "слабое совпадение" };
}

const TONE_CLASS: Record<ScoreTone, string> = {
  good: "bg-emerald-100 text-emerald-900 ring-emerald-600/30 dark:bg-emerald-950 dark:text-emerald-200",
  mid: "bg-amber-100 text-amber-900 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-red-100 text-red-900 ring-red-600/30 dark:bg-red-950 dark:text-red-200",
};

/** Номер для tel: — только цифры и ведущий плюс. */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${phone.replace(/\D/g, "")}`;
}

type Props = {
  item: RankedSupplier;
  selected: boolean;
  /** Лимит сравнения исчерпан: новых поставщиков отметить нельзя. */
  compareFull?: boolean;
  onToggleCompare: (id: string) => void;
  onOpen: (id: string) => void;
  /** Поставщик уже в шортлисте: кнопка работает как переключатель. */
  shortlisted?: boolean;
  onToggleShortlist: (id: string) => void;
};

export function SupplierCard({ item, selected, compareFull = false, onToggleCompare, onOpen, shortlisted = false, onToggleShortlist }: Props) {
  const { supplier: s, score, rank } = item;
  const tone = scoreTone(score.total);
  // Регионы бывают id справочника или свободным текстом — id показываем названием.
  const regions = (s.workRegions.value ?? s.delivery.regions.value ?? []).map((r) => findRegion(r)?.name ?? r);
  const phones = s.contacts.phones.filter((p) => p.value);
  const emails = s.contacts.emails.filter((p) => p.value);
  const messengers = s.contacts.messengers.filter((p) => p.value);
  const certs = s.certificates.value ?? [];
  const site = s.website.value;
  const sourceUrl = s.website.sourceUrl ?? s.sources[0]?.url ?? null;
  const pros = score.pros.slice(0, 3);
  const cons = score.cons.slice(0, 3);
  const bestFor = item.bestFor
    .map((id) => score.breakdown.find((b) => b.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  const titleId = `supplier-${s.id}-title`;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">#{rank} в выдаче</p>
          <h3 id={titleId} className="text-lg leading-snug font-semibold">
            {s.name}
          </h3>
          {regions.length > 0 ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{regions.join(", ")}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Регион работы: нет данных</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className={cn("rounded-lg px-3 py-1.5 text-center ring-1", TONE_CLASS[tone.tone])} data-tone={tone.tone}>
            <span className="text-2xl leading-none font-bold tabular-nums">{score.total}</span>
            <span className="text-xs">/100</span>
          </div>
          <span className="text-xs text-muted-foreground">{tone.label}</span>
        </div>
      </header>

      {bestFor.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bestFor.map((b) => (
            <Badge key={b} variant="secondary">
              Лучший по: {b.toLowerCase()}
            </Badge>
          ))}
        </div>
      )}

      {(pros.length > 0 || cons.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pros.length > 0 && (
            <div>
              <h4 className="sr-only">За</h4>
              <ul className="space-y-1 text-sm">
                {pros.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <CheckIcon aria-label="За" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cons.length > 0 && (
            <div>
              <h4 className="sr-only">Против</h4>
              <ul className="space-y-1 text-sm">
                {cons.map((c) => (
                  <li key={c} className="flex gap-1.5">
                    <XIcon aria-label="Против" className="mt-0.5 size-4 shrink-0 text-red-600" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {score.missing.length > 0 && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>Нет данных: {score.missing.slice(0, 4).join("; ")}</span>
        </p>
      )}

      {certs.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Сертификаты">
          {[...new Set(certs.map((c) => c.type))].map((t) => (
            <Badge key={t} variant="outline">
              {CERTIFICATE_LABELS[t]}
            </Badge>
          ))}
        </div>
      )}

      {(s.minOrder.value || s.priceHint.value || s.delivery.terms.value) && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {s.minOrder.value && (
            <>
              <dt className="text-muted-foreground">Мин. заказ</dt>
              <dd>{s.minOrder.value.rawText}</dd>
            </>
          )}
          {s.priceHint.value && (
            <>
              <dt className="text-muted-foreground">Цена</dt>
              <dd>{s.priceHint.value.rawText}</dd>
            </>
          )}
          {s.delivery.terms.value && (
            <>
              <dt className="text-muted-foreground">Доставка</dt>
              <dd>{s.delivery.terms.value}</dd>
            </>
          )}
        </dl>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
        {phones.length + emails.length + messengers.length === 0 && !site && <p className="text-muted-foreground">Контакты: нет данных</p>}
        {phones.map((p, i) => (
          <a key={`p${i}`} href={telHref(p.value!)} className="inline-flex min-h-8 w-fit items-center gap-2 hover:underline">
            <PhoneIcon aria-hidden className="size-4 text-muted-foreground" />
            {p.value}
          </a>
        ))}
        {emails.map((e, i) => (
          <a key={`e${i}`} href={`mailto:${e.value}`} className="inline-flex min-h-8 w-fit items-center gap-2 break-all hover:underline">
            <MailIcon aria-hidden className="size-4 text-muted-foreground" />
            {e.value}
          </a>
        ))}
        {messengers.map((m, i) => (
          <span key={`m${i}`} className="inline-flex min-h-8 items-center gap-2">
            <span className="w-4 text-center text-xs text-muted-foreground" aria-hidden>
              @
            </span>
            {m.value!.kind}: {m.value!.handle}
          </span>
        ))}
        {site && (
          <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 w-fit items-center gap-2 break-all hover:underline">
            <GlobeIcon aria-hidden className="size-4 text-muted-foreground" />
            {hostOf(site)}
          </a>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={selected} disabled={compareFull && !selected} onChange={() => onToggleCompare(s.id)} />
          К сравнению
        </label>
        <Button type="button" variant="default" size="sm" className="h-8" onClick={() => onOpen(s.id)} aria-label={`Подробнее: ${s.name}`}>
          Подробнее
        </Button>
        <Button
          type="button"
          variant={shortlisted ? "secondary" : "outline"}
          size="sm"
          className="h-8"
          aria-pressed={shortlisted}
          title={shortlisted ? "Нажмите, чтобы убрать из шортлиста" : "Сохранить в шортлист"}
          onClick={() => onToggleShortlist(s.id)}
        >
          {shortlisted ? <BookmarkCheckIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          {shortlisted ? "В шортлисте" : "В шортлист"}
        </Button>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Источник данных: ${hostOf(sourceUrl)}${s.sources.length > 1 ? ` (всего источников: ${s.sources.length})` : ""}`}
            className="ml-auto inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <LinkIcon aria-hidden className="size-4" />
            Источник{s.sources.length > 1 ? ` (${s.sources.length})` : ""}
          </a>
        )}
      </footer>
    </article>
  );
}
