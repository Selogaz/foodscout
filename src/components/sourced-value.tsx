import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Confidence, SourcedField } from "@/domain";
import { CONFIDENCE_LABELS, hostOf } from "@/lib/supplierFormat";
import { cn } from "@/lib/utils";

const DOT: Record<Confidence, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-red-500",
};

/** Метка уверенности: цветная точка + слово (цвет не единственный носитель смысла). */
export function ConfidenceMark({ confidence }: { confidence: Confidence | null }) {
  if (!confidence) return <span className="text-xs text-muted-foreground">уверенность не указана</span>;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
      title={`Уверенность в значении: ${CONFIDENCE_LABELS[confidence]}`}
    >
      <span aria-hidden className={cn("size-2 rounded-full", DOT[confidence])} />
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

/** Иконка-ссылка на страницу, где найдено значение. */
export function SourceLink({ url, what }: { url: string; what?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Источник: ${url}`}
      aria-label={`Источник${what ? ` («${what}»)` : ""}: ${hostOf(url)}`}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}

export function NoData() {
  return <span className="text-muted-foreground italic">нет данных</span>;
}

/**
 * Единственный способ показать извлечённое значение: null → «нет данных»; заполненное —
 * значение, метка уверенности и ссылка на источник (нет ссылки — так и сказано).
 * `compact` — для ячеек таблицы сравнения.
 */
export function SourcedValue<T>({
  field,
  render,
  what,
  compact = false,
}: {
  field: SourcedField<T>;
  render: (value: T) => ReactNode;
  what?: string;
  compact?: boolean;
}) {
  if (field.value === null) return <NoData />;
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 break-words">{render(field.value)}</div>
        {field.sourceUrl !== null && <SourceLink url={field.sourceUrl} what={what} />}
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-2", compact ? "mt-0.5" : "mt-1")}>
        <ConfidenceMark confidence={field.confidence} />
        {field.sourceUrl === null && <span className="text-xs text-muted-foreground">источник не указан</span>}
      </div>
      {!compact && field.note && <p className="mt-1 text-xs text-muted-foreground">{field.note}</p>}
    </div>
  );
}

/** Список полей с происхождением (телефоны, e-mail): каждое значение со своим источником. */
export function SourcedList<T>({
  fields,
  render,
  what,
  compact = false,
}: {
  fields: readonly SourcedField<T>[];
  render: (value: T) => ReactNode;
  what?: string;
  compact?: boolean;
}) {
  const filled = fields.filter((f) => f.value !== null);
  if (filled.length === 0) return <NoData />;
  return (
    <ul className="space-y-1.5">
      {filled.map((f, i) => (
        <li key={i}>
          <SourcedValue field={f} render={render} what={what} compact={compact} />
        </li>
      ))}
    </ul>
  );
}
