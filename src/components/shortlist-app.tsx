"use client";

import { DownloadIcon, GlobeIcon, MailIcon, PhoneIcon, SearchIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdvisorPanel } from "@/components/advisor-panel";
import { NoteEditor } from "@/components/shortlist-note";
import { TagsEditor } from "@/components/shortlist-tags";
import { SupplierDetailSheet } from "@/components/supplier-detail";
import { scoreTone, telHref } from "@/components/supplier-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_ADVISE_SUPPLIERS } from "@/lib/advisor";
import { csvFileName, downloadCsv, shortlistToCsv } from "@/lib/shortlistCsv";
import { SHORTLIST_STATUSES, STATUS_LABELS, useHydrated, useShortlist, type ShortlistEntry, type ShortlistStatus } from "@/lib/shortlistStore";
import { filterEntries, groupByStatus, NO_FILTER, orderForExport, type ShortlistFilter } from "@/lib/shortlistView";
import { formatDate, hostOf } from "@/lib/supplierFormat";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  good: "bg-emerald-100 text-emerald-900 ring-emerald-600/30 dark:bg-emerald-950 dark:text-emerald-200",
  mid: "bg-amber-100 text-amber-900 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-red-100 text-red-900 ring-red-600/30 dark:bg-red-950 dark:text-red-200",
} as const;

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

type CardProps = {
  entry: ShortlistEntry;
  onStatus: (id: string, s: ShortlistStatus) => void;
  onNote: (id: string, note: string) => void;
  onTags: (id: string, tags: string[]) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
};

function ShortlistCard({ entry, onStatus, onNote, onTags, onRemove, onOpen }: CardProps) {
  const { supplier: s, score } = entry.item;
  const tone = scoreTone(score.total);
  const phone = s.contacts.phones.find((p) => p.value)?.value ?? null;
  const email = s.contacts.emails.find((p) => p.value)?.value ?? null;
  const site = s.website.value;
  const titleId = `sl-${entry.id}-title`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-lg leading-snug font-semibold">
            <button type="button" className="text-left hover:underline" onClick={() => onOpen(entry.id)}>
              {s.name}
            </button>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Найден по запросу «{entry.queryLabel}» · добавлен {formatDate(entry.addedAt)}
          </p>
        </div>
        <div className={cn("shrink-0 rounded-lg px-3 py-1.5 text-center ring-1", TONE_CLASS[tone.tone])} title={tone.label}>
          <span className="text-2xl leading-none font-bold tabular-nums">{score.total}</span>
          <span className="text-xs">/100</span>
        </div>
      </header>

      {(phone || email || site) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {phone && (
            <a href={telHref(phone)} className="inline-flex min-h-8 items-center gap-1.5 hover:underline">
              <PhoneIcon aria-hidden className="size-4 text-muted-foreground" />
              {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className="inline-flex min-h-8 items-center gap-1.5 break-all hover:underline">
              <MailIcon aria-hidden className="size-4 text-muted-foreground" />
              {email}
            </a>
          )}
          {site && (
            <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 break-all hover:underline">
              <GlobeIcon aria-hidden className="size-4 text-muted-foreground" />
              {hostOf(site)}
            </a>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`status-${entry.id}`} className="text-sm font-medium">
          Статус
        </label>
        <select
          id={`status-${entry.id}`}
          value={entry.status}
          onChange={(e) => onStatus(entry.id, e.target.value as ShortlistStatus)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-xs md:text-sm dark:bg-input/30"
        >
          {SHORTLIST_STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABELS[st]}
            </option>
          ))}
        </select>
      </div>

      <NoteEditor id={entry.id} label="Заметка" value={entry.note} onSave={onNote} />
      <TagsEditor id={entry.id} name={s.name} tags={entry.tags} onChange={onTags} />

      <footer className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" size="sm" className="h-8" onClick={() => onOpen(entry.id)} aria-label={`Подробнее: ${s.name}`}>
          Подробнее
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => onRemove(entry.id)} aria-label={`Убрать из шортлиста: ${s.name}`}>
          <Trash2Icon data-icon="inline-start" />
          Убрать
        </Button>
      </footer>
    </article>
  );
}

export function ShortlistApp() {
  const hydrated = useHydrated();
  const { entries, persistent, store } = useShortlist();
  const [filter, setFilter] = useState<ShortlistFilter>(NO_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [queryLabel, setQueryLabel] = useState<string | null>(null);

  const visible = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const groups = useMemo(() => groupByStatus(visible), [visible]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(SHORTLIST_STATUSES.map((st) => [st, 0])) as Record<ShortlistStatus, number>;
    entries.forEach((e) => (c[e.status] += 1));
    return c;
  }, [entries]);
  // Совет строится под один запрос: в шортлисте могут быть поставщики из разных поисков.
  const queryOptions = useMemo(() => {
    const m = new Map<string, number>();
    entries.forEach((e) => m.set(e.queryLabel, (m.get(e.queryLabel) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
  }, [entries]);
  const adviceLabel = queryLabel && queryOptions.some((o) => o.label === queryLabel) ? queryLabel : (queryOptions[0]?.label ?? null);
  const adviceEntries = useMemo(
    () => [...entries].filter((e) => e.status !== "rejected").sort((a, b) => b.item.score.total - a.item.score.total).slice(0, MAX_ADVISE_SUPPLIERS),
    [entries],
  );
  const adviceQuery = entries.find((e) => e.queryLabel === adviceLabel)?.query ?? null;
  const openEntry = openId ? (entries.find((e) => e.id === openId) ?? null) : null;

  const remove = (id: string) => {
    const e = entries.find((x) => x.id === id);
    store.remove(id);
    if (e) {
      toast.info(`${e.item.supplier.name} убран из шортлиста`, {
        action: { label: "Вернуть", onClick: () => store.restore(e) },
      });
    }
  };

  const exportCsv = () => {
    downloadCsv(shortlistToCsv(orderForExport(entries)), csvFileName());
    toast.success(`Выгружено: ${entries.length} ${plural(entries.length, "поставщик", "поставщика", "поставщиков")}`);
  };

  const empty = hydrated && entries.length === 0;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Шортлист</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Поставщики, которых вы сохранили из поиска: меняйте статус работы, пишите заметки и выгружайте список в CSV. Данные хранятся только в вашем браузере.
          </p>
        </div>
        {entries.length > 0 && (
          <Button type="button" onClick={exportCsv}>
            <DownloadIcon data-icon="inline-start" />
            Скачать CSV ({entries.length})
          </Button>
        )}
      </div>

      {hydrated && !persistent && (
        <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>Браузер не даёт сохранять данные (приватный режим или запрет). Шортлист работает только до закрытия вкладки: выгрузите CSV, чтобы ничего не потерять.</span>
        </p>
      )}

      {!hydrated && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Загружаем шортлист…
        </p>
      )}

      {empty && (
        <section aria-label="Шортлист пуст" className="mt-8 rounded-xl bg-muted/60 p-6 text-sm">
          <p className="font-medium">В шортлисте пока никого нет.</p>
          <p className="mt-1 text-muted-foreground">Найдите поставщиков и нажмите «В шортлист» в карточке: они появятся здесь.</p>
          <Link href="/" className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
            К поиску
          </Link>
        </section>
      )}

      {hydrated && entries.length > 0 && (
        <>
          {adviceQuery && adviceEntries.length >= 2 && (
            <div className="mt-6">
              {queryOptions.length > 1 && (
                <div className="mb-3 flex flex-col gap-1 text-sm">
                  <label htmlFor="advice-query" className="font-medium">
                    Подсказка для запроса
                  </label>
                  <select
                    id="advice-query"
                    value={adviceLabel ?? ""}
                    onChange={(e) => setQueryLabel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-md md:text-sm dark:bg-input/30"
                  >
                    {queryOptions.map((o) => (
                      <option key={o.label} value={o.label}>
                        {o.label} ({o.n})
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground">В шортлисте поставщики из разных поисков: баллы пересчитываются под выбранный запрос.</p>
                </div>
              )}
              <AdvisorPanel
                suppliers={adviceEntries.map((e) => e.item.supplier)}
                query={adviceQuery}
                scopeLabel="из шортлиста (без отказов)"
                onOpen={setOpenId}
                onDraft={(id) => {
                  setOpenId(id);
                  setDraftOpen(true);
                }}
              />
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3" role="search" aria-label="Фильтр шортлиста">
            <div className="relative max-w-md">
              <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-8"
                value={filter.text}
                onChange={(e) => setFilter({ ...filter, text: e.target.value })}
                placeholder="Название, заметка, тег или запрос"
                aria-label="Поиск по шортлисту"
              />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр по статусу">
              {(["all", ...SHORTLIST_STATUSES] as const).map((st) => {
                const n = st === "all" ? entries.length : counts[st];
                const active = filter.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter({ ...filter, status: st })}
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted",
                      active && "bg-primary text-primary-foreground ring-primary hover:bg-primary",
                    )}
                  >
                    {st === "all" ? "Все" : STATUS_LABELS[st]}
                    <span className="tabular-nums opacity-75">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {groups.length === 0 ? (
            <p role="status" className="mt-6 rounded-lg bg-muted/60 p-4 text-sm">
              Ничего не найдено по этому фильтру.{" "}
              <button type="button" className="underline" onClick={() => setFilter(NO_FILTER)}>
                Сбросить фильтр
              </button>
            </p>
          ) : (
            <div className="mt-6 flex flex-col gap-8">
              {groups.map((g) => (
                <section key={g.status} aria-labelledby={`grp-${g.status}`}>
                  <h2 id={`grp-${g.status}`} className="mb-3 text-lg font-semibold">
                    {STATUS_LABELS[g.status]} <span className="font-normal text-muted-foreground tabular-nums">· {g.entries.length}</span>
                  </h2>
                  <ul className="grid gap-4 lg:grid-cols-2">
                    {g.entries.map((e) => (
                      <li key={e.id} className="flex">
                        <div className="w-full">
                          <ShortlistCard
                            entry={e}
                            onStatus={store.setStatus}
                            onNote={store.setNote}
                            onTags={store.setTags}
                            onRemove={remove}
                            onOpen={setOpenId}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <SupplierDetailSheet
        open={openId !== null && openEntry !== null}
        item={openEntry?.item ?? null}
        status={openEntry ? "ready" : "missing"}
        onClose={() => {
          setOpenId(null);
          setDraftOpen(false);
        }}
        query={openEntry?.query ?? null}
        draftOpen={draftOpen}
        onDraftOpenChange={setDraftOpen}
        shortlisted={openEntry !== null}
        onToggleShortlist={(id) => {
          remove(id);
          setOpenId(null);
        }}
      />
    </>
  );
}
