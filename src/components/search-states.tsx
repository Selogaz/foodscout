import { CircleAlertIcon, ClockIcon, FlaskConicalIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ErrorCode, ResultEvent } from "@/lib/searchEvents";

const formatRecorded = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function DemoBanner({ result }: { result: ResultEvent }) {
  const info = result.demoInfo;
  const example = result.demoReason === "example";
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
      <FlaskConicalIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="font-semibold">{example ? "Записанный пример" : "Демо-данные"}{info ? `, собраны ${formatRecorded(info.recordedAt)}` : ""}</p>
        <p className="mt-0.5">
          {result.demoMessage ?? "Это записанные данные, а не живой поиск."} Это реальные результаты поиска по настоящим сайтам поставщиков, записанные заранее; у каждого значения есть ссылка на источник.
        </p>
        {info && info.match !== "exact" && (
          <p className="mt-1.5 font-medium" data-testid="demo-substitution">
            {info.match === "nearest"
              ? `Точного демо-запроса «${info.requestedLabel}» нет — показан ближайший по категории и региону: «${info.shownLabel}».`
              : `Похожего демо-запроса на «${info.requestedLabel}» нет — показан запрос по умолчанию: «${info.shownLabel}».`}
          </p>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
      <SearchXIcon aria-hidden className="size-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold">Подходящих поставщиков не нашлось</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">Так бывает с узкими запросами. Что можно сделать:</p>
      <ul className="mt-3 max-w-md list-disc space-y-1 pl-5 text-left text-sm">
        <li>выберите регион крупнее или город-миллионник — поставщики часто возят в соседние регионы;</li>
        <li>возьмите категорию шире или уберите поле «Товар»;</li>
        <li>снимите фильтры по сертификатам, МОЗ и доставке.</li>
      </ul>
      <Button type="button" variant="outline" className="mt-5" onClick={onEdit}>
        Изменить запрос
      </Button>
    </div>
  );
}

export function ErrorState({ message, code, onRetry }: { message: string; code: ErrorCode | "network"; onRetry: () => void }) {
  const rate = code === "rate_limited";
  const Icon = rate ? ClockIcon : CircleAlertIcon;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-start sm:p-5">
      <Icon aria-hidden className="size-5 shrink-0 text-destructive sm:mt-0.5" />
      <div className="flex-1">
        <h2 className="font-semibold">{rate ? "Слишком много запросов" : "Не удалось выполнить поиск"}</h2>
        <p className="mt-1 text-sm">{message}</p>
        {rate && <p className="mt-1 text-sm text-muted-foreground">Подождите немного и повторите — данные формы сохранены.</p>}
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
