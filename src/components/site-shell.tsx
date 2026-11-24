import Link from "next/link";
import type { ReactNode } from "react";
import { ShortlistLink } from "@/components/shortlist-link";

/** Общая рамка страниц: шапка со ссылкой на шортлист и подвал. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="inline-flex min-h-9 items-center text-xl font-semibold tracking-tight">
            FoodScout
          </Link>
          <span className="hidden flex-1 text-sm text-muted-foreground md:inline">Поиск поставщиков для food-сегмента</span>
          <nav aria-label="Основная навигация" className="flex items-center gap-1">
            <Link href="/about" className="inline-flex min-h-9 items-center rounded-lg px-2.5 text-sm font-medium hover:bg-muted">
              О сервисе
            </Link>
            <ShortlistLink />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-center text-sm text-muted-foreground">
          <p>
            Made by{" "}
            <a
              href="https://t.me/meaning_inside"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-text font-medium text-foreground underline underline-offset-2"
            >
              Selogaz
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
