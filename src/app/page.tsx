import { SearchApp } from "@/components/search-app";
import { SiteShell } from "@/components/site-shell";

export default function Home() {
  return (
    <SiteShell>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Найдите поставщиков и узнайте, с кем связаться первым
      </h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Укажите категорию продукта и регион — сервис соберёт карточки поставщиков со ссылками на
        источники.
      </p>

      <SearchApp />
    </SiteShell>
  );
}
