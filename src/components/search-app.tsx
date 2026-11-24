"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SearchForm } from "@/components/search-form";
import { SearchProgress } from "@/components/search-progress";
import { EmptyState, ErrorState, DemoBanner } from "@/components/search-states";
import { SupplierCard } from "@/components/supplier-card";
import { useSupplierSearch } from "@/components/use-supplier-search";
import type { SearchQuery } from "@/domain";
import { buildQuery, EMPTY_FORM, formToParams, paramsToForm, type FormState } from "@/lib/formState";

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export function SearchApp() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ category?: string; location?: string; maxMoq?: string }>({});
  const [urlReady, setUrlReady] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const { state, run, cancel } = useSupplierSearch();
  const lastQuery = useRef<SearchQuery | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Форма ↔ URL: при открытии читаем ссылку, дальше каждое изменение пишем обратно.
  useEffect(() => {
    // Однократное чтение URL после гидрации (на сервере его нет) — осознанный setState в эффекте.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(paramsToForm(new URLSearchParams(window.location.search)));
    setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const qs = formToParams(form).toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [form, urlReady]);

  const start = useCallback(
    (f: FormState) => {
      const built = buildQuery(f);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors({});
      setCompare([]);
      lastQuery.current = built.query;
      void run(built.query);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
    [run],
  );

  const change = (next: FormState) => {
    setForm(next);
    if (errors.category || errors.location || errors.maxMoq) setErrors({});
  };

  const editQuery = () => {
    const input = document.querySelector<HTMLInputElement>('form[aria-label="Поиск поставщиков"] input');
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
  };

  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const result = state.result;
  return (
    <>
      <SearchForm
        form={form}
        onChange={change}
        errors={errors}
        busy={state.status === "loading"}
        onSubmit={() => start(form)}
        onCancel={cancel}
        onExample={(f) => {
          setForm(f);
          start(f);
        }}
      />

      <div ref={resultsRef} className="scroll-mt-4">
        {state.status === "loading" && <SearchProgress state={state} />}

        {state.status === "error" && state.error && (
          <div className="mt-6">
            <ErrorState message={state.error.message} code={state.error.code} onRetry={() => lastQuery.current && void run(lastQuery.current)} />
          </div>
        )}

        {state.status === "done" && result && (
          <section aria-label="Результаты поиска" className="mt-6 flex flex-col gap-4">
            {result.demo && <DemoBanner result={result} />}
            {result.results.length === 0 ? (
              <EmptyState onEdit={editQuery} />
            ) : (
              <>
                <div>
                  <h2 className="text-xl font-semibold">
                    Найдено {result.results.length} {plural(result.results.length, "поставщик", "поставщика", "поставщиков")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Лучшие совпадения сверху. Балл показывает, насколько поставщик подходит под запрос; причины — в карточке.
                    {result.cached && " Ответ взят из кеша: так же отвечали на такой же запрос недавно."}
                  </p>
                </div>
                {result.warnings.length > 0 && (
                  <ul className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <ul className="grid gap-4 lg:grid-cols-2">
                  {result.results.map((item) => (
                    <li key={item.supplier.id} className="flex">
                      <div className="w-full">
                        <SupplierCard
                          item={item}
                          selected={compare.includes(item.supplier.id)}
                          onToggleCompare={toggleCompare}
                          onShortlist={() => toast.info("Шортлист появится в следующей версии", { description: "Пока можно отметить карточки «К сравнению»." })}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      {compare.length > 0 && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-1 text-sm">
            <span>
              К сравнению отмечено: <strong>{compare.length}</strong>. Таблица сравнения появится в следующей версии.
            </span>
            <button type="button" className="shrink-0 underline" onClick={() => setCompare([])}>
              Сбросить
            </button>
          </div>
        </div>
      )}
    </>
  );
}
