import { SearchApp } from "@/components/search-app";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-xl font-semibold tracking-tight">FoodScout</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Поиск поставщиков для food-сегмента
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Найдите поставщиков и узнайте, с кем связаться первым
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Укажите категорию продукта и регион — сервис соберёт карточки поставщиков со ссылками на
          источники.
        </p>

        <SearchApp />
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-muted-foreground">
          © FoodScout — прототип. Данные о поставщиках приводятся со ссылками на источники.
        </div>
      </footer>
    </div>
  );
}
