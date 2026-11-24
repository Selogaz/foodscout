import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "FoodScout — поиск поставщиков",
  description: "Поиск и сравнение поставщиков в food-сегменте: ингредиенты, готовая продукция, упаковка.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}
        <Toaster position="bottom-center" duration={3000} offset={{ bottom: 88 }} mobileOffset={{ bottom: 88 }} />
      </body>
    </html>
  );
}
