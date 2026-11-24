import { afterEach, describe, expect, it } from "vitest";
import { YandexSearchProvider } from "../search";
import { getSearchProvider, resetSearchProvider } from "./runtime";

const env = { YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f" };

describe("общий провайдер поиска", () => {
  afterEach(resetSearchProvider);

  it("один экземпляр на процесс: очередь запросов общая", () => {
    const a = getSearchProvider(env);
    expect(a).toBeInstanceOf(YandexSearchProvider);
    expect(getSearchProvider(env)).toBe(a);
  });

  it("нет ключа — null; появился ключ — провайдер создаётся", () => {
    expect(getSearchProvider({})).toBeNull();
    expect(getSearchProvider(env)).toBeInstanceOf(YandexSearchProvider);
  });

  it("смена ключа даёт новый провайдер, сброс очищает кеш", () => {
    const a = getSearchProvider(env);
    expect(getSearchProvider({ ...env, YANDEX_API_KEY: "other" })).not.toBe(a);
    const b = getSearchProvider(env);
    resetSearchProvider();
    expect(getSearchProvider(env)).not.toBe(b);
  });
});
