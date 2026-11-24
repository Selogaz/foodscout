import { rankSuppliers, type RankedSupplier, type SearchQuery } from "@/domain";
import { supplierFixtures } from "@/domain/__fixtures__/suppliers";

/**
 * Ближайший демо-прогон для запроса. Пока записанных прогонов нет (src/data/demo),
 * берём вымышленные поставщики из фикстур домена и ранжируем их под запрос:
 * релевантность категории в скоринге сама опускает чужие позиции вниз.
 * Единственная точка замены — эта функция: здесь подбирается запись по категории и региону.
 */
export function pickDemoRun(query: SearchQuery): { results: RankedSupplier[]; warnings: string[] } {
  return {
    results: rankSuppliers(supplierFixtures, query),
    warnings: ["Это демонстрационные данные: компании вымышленные, сайты — заглушки (example.*)."],
  };
}
