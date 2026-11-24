"use client";

import { useState } from "react";
import { ChevronDownIcon, SearchIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/combobox";
import { CERTIFICATE_LABELS, CERTIFICATE_TYPES, type CertificateType } from "@/domain";
import { CATEGORY_OPTIONS, EXAMPLES, LOCATION_OPTIONS, MOQ_UNITS, type FormState } from "@/lib/formState";
import { cn } from "@/lib/utils";

type Props = {
  form: FormState;
  onChange: (next: FormState) => void;
  errors: { category?: string; location?: string; maxMoq?: string };
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onExample: (form: FormState) => void;
};

const selectCls =
  "h-10 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm dark:bg-input/30";

export function SearchForm({ form, onChange, errors, busy, onSubmit, onCancel, onExample }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onChange({ ...form, [k]: v });
  const activeFilters =
    form.certificates.length + (form.maxMoq.trim() ? 1 : 0) + (form.needDelivery ? 1 : 0) + (form.priceImportance !== "medium" ? 1 : 0);
  // Фильтры с ошибкой нельзя прятать: пользователь не увидит причину.
  const filtersShown = filtersOpen || Boolean(errors.maxMoq);

  const toggleCert = (c: CertificateType) =>
    set("certificates", form.certificates.includes(c) ? form.certificates.filter((x) => x !== c) : [...form.certificates, c]);

  return (
    <form
      aria-label="Поиск поставщиков"
      noValidate
      className="mt-6 flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Combobox
          label="Категория"
          required
          value={form.category}
          onChange={(v) => set("category", v)}
          options={CATEGORY_OPTIONS}
          placeholder="Выберите или введите свою"
          description="Из справочника или свободный текст, например «крафтовая упаковка для кофе»."
          error={errors.category}
        />
        <Combobox
          label="Город или регион"
          required
          value={form.location}
          onChange={(v) => set("location", v)}
          options={LOCATION_OPTIONS}
          placeholder="Например, Казань"
          description="Поставщики этого региона и те, кто возит туда."
          error={errors.location}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="product" className="text-sm font-medium">
          Товар <span className="font-normal text-muted-foreground">(необязательно)</span>
        </label>
        <Input
          id="product"
          className="h-10 md:h-9"
          placeholder="Например, мука пшеничная в/с"
          value={form.product}
          maxLength={200}
          onChange={(e) => set("product", e.target.value)}
        />
      </div>

      <div>
        <button
          type="button"
          aria-expanded={filtersShown}
          aria-controls="filters-panel"
          onClick={() => setFiltersOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDownIcon className={cn("size-4 transition-transform", filtersShown && "rotate-180")} />
          Фильтры{activeFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeFilters}</span>}
        </button>
        <div id="filters-panel" hidden={!filtersShown} className="mt-3 grid gap-5 border-t pt-4 md:grid-cols-2">
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Нужные сертификаты и документы</legend>
            <div className="flex flex-wrap gap-2">
              {CERTIFICATE_TYPES.filter((c) => c !== "other").map((c) => {
                const on = form.certificates.includes(c);
                return (
                  <label
                    key={c}
                    className={cn(
                      "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      on ? "border-primary bg-primary/5 font-medium" : "border-input",
                    )}
                  >
                    <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => toggleCert(c)} />
                    {CERTIFICATE_LABELS[c]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="moq" className="text-sm font-medium">
              Максимальный минимальный заказ (МОЗ)
            </label>
            <div className="flex gap-2">
              <Input
                id="moq"
                inputMode="decimal"
                className="h-10 md:h-9"
                placeholder="Например, 500"
                value={form.maxMoq}
                aria-invalid={errors.maxMoq ? true : undefined}
                aria-describedby={errors.maxMoq ? "moq-err" : undefined}
                onChange={(e) => set("maxMoq", e.target.value)}
              />
              <select aria-label="Единица МОЗ" className={selectCls} value={form.moqUnit} onChange={(e) => set("moqUnit", e.target.value)}>
                {MOQ_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            {errors.maxMoq && (
              <p id="moq-err" className="text-xs text-destructive">
                {errors.maxMoq}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="price-importance" className="text-sm font-medium">
              Насколько важна цена
            </label>
            <select
              id="price-importance"
              className={selectCls}
              value={form.priceImportance}
              onChange={(e) => set("priceImportance", e.target.value as FormState["priceImportance"])}
            >
              <option value="low">Не очень</option>
              <option value="medium">Средне</option>
              <option value="high">Очень важна</option>
            </select>
          </div>

          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" className="size-4 accent-primary" checked={form.needDelivery} onChange={(e) => set("needDelivery", e.target.checked)} />
            Нужна доставка в мой регион
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" className="h-10 px-5 md:h-9" disabled={busy}>
          <SearchIcon data-icon="inline-start" />
          {busy ? "Ищем…" : "Найти поставщиков"}
        </Button>
        {busy && (
          <Button type="button" variant="outline" size="lg" className="h-10 md:h-9" onClick={onCancel}>
            <SquareIcon data-icon="inline-start" />
            Остановить
          </Button>
        )}
      </div>

      <div className="border-t pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Попробовать пример</p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.label}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onExample(ex.form)}
                className="min-h-9 rounded-full border border-input px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {ex.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
