"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboOption = { id: string; label: string; hint?: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

type Props = {
  label: string;
  value: string;
  onChange: (text: string) => void;
  options: readonly ComboOption[];
  placeholder?: string;
  /** Подсказка под полем. */
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

/**
 * Комбобокс (ARIA 1.2): поле ввода со списком подсказок. Текст в поле — единственный источник
 * значения, поэтому подходит и для выбора из справочника, и для свободного ввода.
 * Клавиши: ↓/↑ — по списку, Enter — выбрать, Esc — закрыть, Tab — уйти из поля.
 */
export function Combobox({ label, value, onChange, options, placeholder, description, error, required, className }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const n = norm(value);
    // Если в поле уже точное название — показываем весь список, а не единственный пункт.
    const exact = options.some((o) => norm(o.label) === n);
    if (!n || exact) return options.slice(0, 40);
    return options.filter((o) => norm(o.label).includes(n) || norm(o.hint ?? "").includes(n)).slice(0, 40);
  }, [options, value]);

  const choose = (o: ComboOption) => {
    onChange(o.label);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const descId = description ? `${uid}-desc` : undefined;
  const errId = error ? `${uid}-err` : undefined;
  const expanded = open && shown.length > 0;

  return (
    <div className={cn("relative flex flex-col gap-1.5", className)}>
      <label htmlFor={`${uid}-input`} className="text-sm font-medium">
        {label}
        {required && <span aria-hidden className="text-destructive"> *</span>}
      </label>
      <div className="relative">
        <Input
          ref={inputRef}
          id={`${uid}-input`}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${uid}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descId, errId].filter(Boolean).join(" ") || undefined}
          autoComplete="off"
          className="h-10 pr-9 md:h-9"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Открыть список вариантов"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
            setOpen((o) => !o);
          }}
        >
          <ChevronDownIcon className="size-4" />
        </button>
        {expanded && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {shown.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5",
                  i === active && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {description && !error && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
