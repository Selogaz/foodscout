import type { Metadata } from "next";
import { ShortlistApp } from "@/components/shortlist-app";
import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Шортлист — FoodScout",
  description: "Сохранённые поставщики: статусы работы, заметки, теги и выгрузка в CSV.",
};

export default function ShortlistPage() {
  return (
    <SiteShell>
      <ShortlistApp />
    </SiteShell>
  );
}
