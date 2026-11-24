"use client";

import { CopyIcon, LoaderCircleIcon, MailIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SearchQuery, Supplier } from "@/domain";
import { mailtoHref, queryPlace, type DraftResult } from "@/lib/advisor";
import { requestDraft } from "@/lib/assistClient";

const NOTE: Record<NonNullable<DraftResult["fallbackReason"]>, string> = {
  "demo-mode": "Письмо собрано по шаблону без модели: на этом стенде ИИ отключён.",
  "no-key": "Письмо собрано по шаблону без модели: ключ ИИ не настроен.",
  limit: "Письмо собрано по шаблону без модели: суточный лимит исчерпан.",
  failed: "Письмо собрано по шаблону: вступление от модели не прошло проверку или она не ответила.",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Черновик запроса КП под поставщика: объём и город вводит пользователь, текст можно править. */
export function DraftRequest({ supplier, query }: { supplier: Supplier; query: SearchQuery }) {
  const defaultCity = queryPlace(query).name;
  const [volume, setVolume] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);

  const generate = async () => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setBusy(true);
    setError(null);
    try {
      const d = await requestDraft({ query, supplier, volume, deliveryCity: city.trim() === defaultCity ? "" : city }, c.signal);
      if (c.signal.aborted) return;
      setDraft(d);
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Не удалось составить черновик.");
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };

  const copy = async () => {
    const ok = await copyText(`Тема: ${subject}\n\n${body}`);
    if (ok) toast.success("Письмо скопировано", { duration: 2000 });
    else toast.error("Не удалось скопировать: выделите текст и скопируйте вручную");
  };

  return (
    <section aria-labelledby="draft-title" className="border-t bg-muted/40 px-4 py-4">
      <h3 id="draft-title" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Черновик запроса КП
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">Товар берётся из запроса, вопросы — по недостающим данным карточки. Объём укажите сами: сервис его не придумывает.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Нужный объём
          <Input value={volume} maxLength={200} onChange={(e) => setVolume(e.target.value)} placeholder="например, 2 т в месяц" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Город доставки
          <Input value={city} maxLength={120} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>
      <Button type="button" className="mt-3" onClick={generate} disabled={busy}>
        {busy ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : draft ? <RefreshCwIcon data-icon="inline-start" /> : null}
        {draft ? "Составить заново" : "Составить черновик"}
      </Button>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {draft && (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Тема
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Текст письма (можно править)
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-64 font-normal" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={copy}>
              <CopyIcon data-icon="inline-start" />
              Копировать
            </Button>
            {draft.email ? (
              <a
                href={mailtoHref(draft.email, subject, body)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <MailIcon aria-hidden className="size-4" />
                Открыть в почте
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">E-mail в карточке не найден: скопируйте текст и отправьте через сайт или мессенджер.</span>
            )}
          </div>
          {draft.email && <p className="text-xs text-muted-foreground">Адрес получателя: {draft.email} (из карточки, есть источник).</p>}
          <p className="text-xs text-muted-foreground">
            {draft.source === "llm" ? "Вступление написала модель по данным карточки (проверено: чисел и ссылок вне карточки нет); остальное — шаблон." : NOTE[draft.fallbackReason ?? "failed"]}
          </p>
        </div>
      )}
    </section>
  );
}
