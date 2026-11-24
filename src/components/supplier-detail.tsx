"use client";

import { CheckIcon, FileTextIcon, InfoIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NoData, SourcedList, SourcedValue } from "@/components/sourced-value";
import { scoreTone, telHref } from "@/components/supplier-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CERTIFICATE_LABELS, type RankedSupplier } from "@/domain";
import { formatDate, hostOf, MESSENGER_LABELS, regionNames, SOURCE_TYPE_LABELS } from "@/lib/supplierFormat";
import { cn } from "@/lib/utils";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `sec-${title.replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="border-t px-4 py-4">
      <h3 id={id} className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const linkCls = "break-all hover:underline";

/** Содержимое карточки: «насколько можно верить данным». */
export function SupplierDetail({ item }: { item: RankedSupplier }) {
  const { supplier: s, score } = item;
  const tone = scoreTone(score.total);
  const applicable = score.breakdown.filter((b) => b.applicable);
  const skipped = score.breakdown.filter((b) => !b.applicable);

  return (
    <div className="pb-6">
      <Section title="О компании">
        <Rows>
          <Row label="Описание">
            <SourcedValue field={s.description} render={(v) => v} what="описание" />
          </Row>
          <Row label="Собрано">{formatDate(s.collectedAt)}</Row>
        </Rows>
      </Section>

      <Section title="Контакты">
        <Rows>
          <Row label="Сайт">
            <SourcedValue
              field={s.website}
              what="сайт"
              render={(v) => (
                <a href={v} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  {hostOf(v)}
                </a>
              )}
            />
          </Row>
          <Row label="Телефоны">
            <SourcedList
              fields={s.contacts.phones}
              what="телефон"
              render={(v) => (
                <a href={telHref(v)} className={linkCls}>
                  {v}
                </a>
              )}
            />
          </Row>
          <Row label="E-mail">
            <SourcedList
              fields={s.contacts.emails}
              what="e-mail"
              render={(v) => (
                <a href={`mailto:${v}`} className={linkCls}>
                  {v}
                </a>
              )}
            />
          </Row>
          <Row label="Мессенджеры">
            <SourcedList fields={s.contacts.messengers} what="мессенджер" render={(v) => `${MESSENGER_LABELS[v.kind] ?? v.kind}: ${v.handle}`} />
          </Row>
          <Row label="Адрес">
            <SourcedValue field={s.contacts.address} what="адрес" render={(v) => v} />
          </Row>
        </Rows>
      </Section>

      <Section title="Условия">
        <Rows>
          <Row label="Мин. заказ">
            <SourcedValue field={s.minOrder} what="минимальный заказ" render={(v) => v.rawText} />
          </Row>
          <Row label="Цена">
            <SourcedValue field={s.priceHint} what="цена" render={(v) => v.rawText} />
          </Row>
          <Row label="Доставка">
            <SourcedValue field={s.delivery.terms} what="условия доставки" render={(v) => v} />
          </Row>
          <Row label="Самовывоз">
            <SourcedValue field={s.delivery.pickup} what="самовывоз" render={(v) => (v ? "Есть" : "Нет")} />
          </Row>
          <Row label="Регионы доставки">
            <SourcedValue field={s.delivery.regions} what="регионы доставки" render={(v) => regionNames(v)} />
          </Row>
          <Row label="Регионы работы">
            <SourcedValue field={s.workRegions} what="регионы работы" render={(v) => regionNames(v)} />
          </Row>
        </Rows>
      </Section>

      <Section title="Документы">
        <SourcedValue
          field={s.certificates}
          what="сертификаты"
          render={(list) => (
            <ul className="space-y-1.5">
              {list.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline">{CERTIFICATE_LABELS[c.type]}</Badge>
                  {c.title !== null && <span>{c.title}</span>}
                  {c.documentUrl !== null && (
                    <a
                      href={c.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <FileTextIcon aria-hidden className="size-3.5" />
                      документ
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        />
      </Section>

      <Section title="Источники">
        {s.sources.length === 0 ? (
          <NoData />
        ) : (
          <ul className="space-y-2 text-sm">
            {s.sources.map((src) => (
              <li key={src.url}>
                <div className="min-w-0">
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className={cn(linkCls, "block")}>
                    {src.url}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {SOURCE_TYPE_LABELS[src.type]} · собрано {formatDate(src.collectedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Почему такой балл">
        <p className="mb-3 text-sm">
          Итог: <strong className="tabular-nums">{score.total}/100</strong> — {tone.label}. Баллы дают только данные, подтверждённые источником;
          «нет данных» не засчитывается как совпадение.
        </p>
        <ul className="space-y-2.5">
          {applicable.map((b) => (
            <li key={b.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span>{b.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(b.points * 10) / 10} из {b.weight}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(b.score * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
        {skipped.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Не участвовало (в запросе не задано): {skipped.map((b) => b.label.toLowerCase()).join(", ")}.</p>
        )}
        {score.relevanceFactor < 1 && (
          <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Категория поставщика не полностью совпала с запросом, поэтому итог умножен на {score.relevanceFactor.toFixed(2)}.
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {score.pros.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Что совпало">
              {score.pros.map((p) => (
                <li key={p} className="flex gap-1.5">
                  <CheckIcon aria-label="За" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {score.cons.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Что не совпало">
              {score.cons.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <XIcon aria-label="Против" className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {score.missing.length > 0 && (
          <div className="mt-4 text-sm">
            <p className="font-medium">Каких данных не хватает</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {score.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}

export type DetailStatus = "loading" | "ready" | "missing";

type SheetProps = {
  open: boolean;
  item: RankedSupplier | null;
  /** Почему карточки нет: идёт поиск или результатов (с этим поставщиком) нет. */
  status: DetailStatus;
  onClose: () => void;
  onRestore?: (() => void) | null;
};

/** Карточка в боковой панели: на десктопе справа, на мобиле — на весь экран. */
export function SupplierDetailSheet({ open, item, status, onClose, onRestore }: SheetProps) {
  const tone = item ? scoreTone(item.score.total) : null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover pr-12">
          <SheetClose render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Закрыть карточку" />}>
            <XIcon />
          </SheetClose>
          <SheetTitle className="text-lg leading-snug">{item ? item.supplier.name : "Карточка поставщика"}</SheetTitle>
          <SheetDescription>
            {item && tone
              ? `#${item.rank} в выдаче · балл ${item.score.total}/100, ${tone.label}`
              : "Данные со ссылками на источники"}
          </SheetDescription>
        </SheetHeader>
        {item && status === "ready" ? (
          <SupplierDetail item={item} />
        ) : (
          <div className="space-y-3 p-4 text-sm" role="status">
            {status === "loading" ? (
              <p>Идёт поиск. Карточка откроется, когда результаты будут готовы.</p>
            ) : (
              <>
                <p className="font-medium">Эту карточку сейчас нельзя открыть.</p>
                <p className="text-muted-foreground">
                  Результаты поиска не сохраняются между визитами: ссылка на карточку работает, только пока открыта выдача с этим поставщиком.
                  Запустите поиск заново.
                </p>
                {onRestore && (
                  <Button type="button" onClick={onRestore}>
                    Повторить поиск из ссылки
                  </Button>
                )}
              </>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
