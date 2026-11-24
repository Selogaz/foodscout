import Link from "next/link";
import type { ReactNode } from "react";
import { ShortlistLink } from "@/components/shortlist-link";

/** Общая рамка страниц: шапка со ссылкой на шортлист и подвал. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            FoodScout
          </Link>
          <span className="hidden flex-1 text-sm text-muted-foreground md:inline">Поиск поставщиков для food-сегмента</span>
          <nav aria-label="Основная навигация">
            <ShortlistLink />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-muted-foreground">
          © FoodScout — прототип. Данные о поставщиках приводятся со ссылками на источники.
        </div>
      </footer>
    </div>
  );
}
