"use client";

import { BookmarkIcon } from "lucide-react";
import Link from "next/link";
import { useShortlist } from "@/lib/shortlistStore";

/** Ссылка в шапке с счётчиком. До гидрации счётчик не показывается (на сервере localStorage нет). */
export function ShortlistLink() {
  const { entries } = useShortlist();
  const n = entries.length;
  return (
    <Link
      href="/shortlist"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-muted"
    >
      <BookmarkIcon aria-hidden className="size-4" />
      <span>Шортлист</span>
      {n > 0 && (
        <>
          <span aria-hidden className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs leading-5 font-semibold text-primary-foreground tabular-nums">
            {n}
          </span>
          <span className="sr-only">, сохранено: {n}</span>
        </>
      )}
    </Link>
  );
}
