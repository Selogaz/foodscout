import Link from "next/link";
import { SiteShell } from "@/components/site-shell";

export default function NotFound() {
  return (
    <SiteShell>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Страница не найдена</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">Такого адреса нет. Вернитесь к поиску поставщиков или откройте шортлист.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
          К поиску
        </Link>
        <Link href="/shortlist" className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">
          Шортлист
        </Link>
      </div>
    </SiteShell>
  );
}
