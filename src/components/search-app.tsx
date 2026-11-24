"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CompareTable } from "@/components/compare-table";
import { SearchForm } from "@/components/search-form";
import { SearchProgress } from "@/components/search-progress";
import { EmptyState, ErrorState, DemoBanner } from "@/components/search-states";
import { SupplierCard } from "@/components/supplier-card";
import { SupplierDetailSheet, type DetailStatus } from "@/components/supplier-detail";
import { Button } from "@/components/ui/button";
import { useSupplierSearch } from "@/components/use-supplier-search";
import type { SearchQuery } from "@/domain";
import { MAX_COMPARE, MIN_COMPARE } from "@/lib/compare";
import { useShortlist } from "@/lib/shortlistStore";
import { buildQuery, EMPTY_FORM, formToParams, hasFormParams, paramsToForm, type FormState } from "@/lib/formState";

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export function SearchApp() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ category?: string; location?: string; maxMoq?: string }>({});
  const [urlReady, setUrlReady] = useState(false);
  const [urlHasQuery, setUrlHasQuery] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  /** Открытая детальная карточка (`?s=<id>`) и режим «Сравнение» (`?v=compare`): оба живут в URL. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"results" | "compare">("results");
  const { state, run, cancel } = useSupplierSearch();
  const shortlist = useShortlist();
  const router = useRouter();
  const lastQuery = useRef<SearchQuery | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Форма ↔ URL: при открытии читаем ссылку, дальше каждое изменение пишем обратно.
  useEffect(() => {
    // Однократное чтение URL после гидрации (на сервере его нет) — осознанный setState в эффекте.
    /* eslint-disable react-hooks/set-state-in-effect */
    const params = new URLSearchParams(window.location.search);
    setForm(paramsToForm(params));
    setOpenId(params.get("s"));
    setCompare((params.get("cmp") ?? "").split(",").filter(Boolean).slice(0, MAX_COMPARE));
    setView(params.get("v") === "compare" ? "compare" : "results");
    setUrlHasQuery(hasFormParams(params));
    setUrlReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const params = formToParams(form);
    if (compare.length > 0) params.set("cmp", compare.join(","));
    if (view === "compare") params.set("v", "compare");
    if (openId) params.set("s", openId);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [form, urlReady, compare, view, openId]);

  const start = useCallback(
    (f: FormState, keepSelection = false) => {
      const built = buildQuery(f);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors({});
      if (!keepSelection) {
        setCompare([]);
        setView("results");
        setOpenId(null);
      }
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

  const toggleCompare = (id: string) => {
    if (!compare.includes(id) && compare.length >= MAX_COMPARE) {
      toast.info(`В сравнении не больше ${MAX_COMPARE} поставщиков`, { description: "Уберите кого-нибудь, чтобы добавить другого." });
      return;
    }
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  const removeFromCompare = (id: string) => {
    const next = compare.filter((x) => x !== id);
    setCompare(next);
    if (next.length < MIN_COMPARE) setView("results");
  };

  const result = state.result;
  const ranked = result?.results ?? [];
  const shortlistedIds = new Set(shortlist.entries.map((e) => e.id));
  const toggleShortlist = (id: string) => {
    const item = ranked.find((r) => r.supplier.id === id);
    if (!item || !result) return;
    if (shortlist.store.has(id)) {
      shortlist.store.remove(id);
      toast.info(`${item.supplier.name} убран из шортлиста`, { duration: 3000 });
      return;
    }
    shortlist.store.add(item, result.query);
    toast.success(`${item.supplier.name} в шортлисте`, {
      action: { label: "Открыть шортлист", onClick: () => router.push("/shortlist") },
      duration: 3000,
    });
    if (!shortlist.store.getSnapshot().persistent) {
      toast.warning("Браузер не даёт сохранять данные", { description: "Шортлист останется только до закрытия вкладки." });
    }
  };
  const openItem = openId ? (ranked.find((r) => r.supplier.id === openId) ?? null) : null;
  const detailStatus: DetailStatus = openItem ? "ready" : state.status === "loading" ? "loading" : "missing";
  // Ссылку на карточку/сравнение открыли без результатов: можно повторить поиск по параметрам из URL.
  const canRestore = urlHasQuery && state.status !== "done" && state.status !== "loading";
  const restore = () => start(form, true);
  const compareItems = compare.flatMap((id) => ranked.filter((r) => r.supplier.id === id));
  const showCompare = view === "compare";
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
            ) : showCompare ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold">Сравнение: {compareItems.length} {plural(compareItems.length, "поставщик", "поставщика", "поставщиков")}</h2>
                  <Button type="button" variant="outline" size="sm" onClick={() => setView("results")}>
                    К результатам
                  </Button>
                </div>
                {compareItems.length < MIN_COMPARE ? (
                  <p role="status" className="rounded-lg bg-muted/60 p-3 text-sm">
                    Для сравнения нужно минимум {MIN_COMPARE} поставщика: вернитесь к результатам и отметьте «К сравнению».
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Лучшее значение в строке подсвечено: больше баллов, меньше минимальный заказ и цена (если единицы совпадают), больше сертификатов и регионов.
                      Пропуски помечены «нет данных». Название поставщика открывает карточку.
                    </p>
                    <CompareTable items={compareItems} onOpen={setOpenId} onRemove={removeFromCompare} />
                  </>
                )}
              </div>
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
                          compareFull={compare.length >= MAX_COMPARE}
                          onToggleCompare={toggleCompare}
                          onOpen={setOpenId}
                          shortlisted={shortlistedIds.has(item.supplier.id)}
                          onToggleShortlist={toggleShortlist}
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

      {showCompare && state.status !== "done" && (
        <section aria-label="Сравнение" className="mt-6 rounded-lg bg-muted/60 p-4 text-sm" role="status">
          <p>Сравнение строится по результатам поиска, а они не сохраняются между визитами. Запустите поиск заново.</p>
          {canRestore && (
            <Button type="button" className="mt-3" onClick={restore}>
              Повторить поиск из ссылки
            </Button>
          )}
        </section>
      )}

      {compare.length > 0 && !showCompare && state.status === "done" && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-1 text-sm">
            <span>
              К сравнению отмечено: <strong>{compare.length}</strong>
              {compare.length < MIN_COMPARE && ` (нужно минимум ${MIN_COMPARE})`}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button type="button" className="underline" onClick={() => setCompare([])}>
                Сбросить
              </button>
              <Button type="button" size="sm" disabled={compare.length < MIN_COMPARE} onClick={() => setView("compare")}>
                Сравнить
              </Button>
            </span>
          </div>
        </div>
      )}

      <SupplierDetailSheet open={openId !== null} item={openItem} status={detailStatus} onClose={() => setOpenId(null)} onRestore={canRestore ? restore : null}
        shortlisted={openItem ? shortlistedIds.has(openItem.supplier.id) : false}
        onToggleShortlist={toggleShortlist}
      />
    </>
  );
}
