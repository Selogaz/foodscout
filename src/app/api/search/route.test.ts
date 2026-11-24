import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_EXAMPLES } from "@/data/demo";
import { validQueryFixtures } from "@/domain/__fixtures__/queries";
import { buildQuery, EMPTY_FORM } from "@/lib/formState";
import { SearchClientError, streamSearch, NdjsonLineParser } from "@/lib/searchClient";
import type { SearchEvent } from "@/lib/searchEvents";
import { POST } from "./route";

const call = (body: unknown, ip = "1.1.1.1") =>
  POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  delete (globalThis as { __fscApiState?: unknown }).__fscApiState;
  vi.stubEnv("YANDEX_API_KEY", "");
  vi.stubEnv("YANDEX_FOLDER_ID", "");
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("DEMO_MODE", "auto");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/search", () => {
  it("невалидный JSON → 400 по-русски", async () => {
    const res = await call("{не json");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/JSON/);
  });

  it("невалидная схема → 400 с указанием поля", async () => {
    const res = await call({ category: { kind: "catalog", categoryId: "nope" }, location: { regionId: "moscow", cityId: null } });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j).toMatchObject({ type: "error", code: "invalid_request" });
    expect(j.message).toContain("category.categoryId");
    expect(j.issues[0].message).toBe("Неизвестная категория");
  });

  it("без ключа отдаёт NDJSON-поток с demo: true", async () => {
    const res = await call(validQueryFixtures.catalogMoscow);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as SearchEvent);
    expect(lines.at(-1)).toMatchObject({ type: "result", demo: true, demoReason: "no-key" });
  });

  it("лимит частоты → 429 с Retry-After", async () => {
    for (let i = 0; i < 5; i++) expect((await call(validQueryFixtures.catalogMoscow, "9.9.9.9")).status).toBe(200);
    const res = await call(validQueryFixtures.catalogMoscow, "9.9.9.9");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await res.json()).message).toMatch(/Слишком много запросов/);
    expect((await call(validQueryFixtures.catalogMoscow, "8.8.8.8")).status).toBe(200);
  });

  it("DEMO_MODE=on: лимит не применяется (ответ из записи ничего не стоит), в ответе есть дата записи", async () => {
    vi.stubEnv("DEMO_MODE", "on");
    for (let i = 0; i < 8; i++) expect((await call(validQueryFixtures.catalogMoscow, "7.7.7.7")).status).toBe(200);
    const res = await call(validQueryFixtures.catalogMoscow, "7.7.7.7");
    const last = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as SearchEvent).at(-1);
    expect(last).toMatchObject({ type: "result", demo: true, demoReason: "demo-mode", demoInfo: { match: "nearest" } });
  });
});

describe("чип-пример в режиме auto", () => {
  it("точный пример: из записи, без лимита частоты", async () => {
    const ex = DEMO_EXAMPLES[0];
    const r = buildQuery({ ...EMPTY_FORM, category: ex.category, product: ex.product, location: ex.location });
    if (!r.ok) throw new Error("запрос не собрался");
    for (let i = 0; i < 8; i++) expect((await call(r.query, "6.6.6.6")).status).toBe(200);
    const last = (await (await call(r.query, "6.6.6.6")).text()).trim().split("\n").map((l) => JSON.parse(l) as SearchEvent).at(-1);
    expect(last).toMatchObject({ type: "result", demo: true, demoReason: "example", demoInfo: { match: "exact" } });
  });
});

describe("клиент streamSearch", () => {
  const viaRoute: typeof fetch = (_url, init) => POST(new Request("http://localhost/api/search", init));

  it("читает поток, отдаёт события и итоговый result", async () => {
    const events: SearchEvent[] = [];
    const r = await streamSearch(validQueryFixtures.catalogMoscow, { fetchImpl: viaRoute, onEvent: (e) => events.push(e) });
    expect(r.demo).toBe(true);
    expect(events.map((e) => e.type)).toContain("stage");
    expect(events.at(-1)?.type).toBe("result");
  });

  it("400 превращается в SearchClientError с issues", async () => {
    const err = await streamSearch({ nonsense: 1 } as never, { fetchImpl: viaRoute }).catch((e) => e);
    expect(err).toBeInstanceOf(SearchClientError);
    expect(err.code).toBe("invalid_request");
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it("сетевая ошибка → понятное сообщение", async () => {
    const err = await streamSearch(validQueryFixtures.catalogMoscow, { fetchImpl: () => Promise.reject(new Error("x")) }).catch((e) => e);
    expect(err).toMatchObject({ code: "network" });
  });

  it("парсер собирает строки из кусков и пропускает мусор", () => {
    const p = new NdjsonLineParser();
    expect(p.push('{"type":"warn')).toEqual([]);
    expect(p.push('ing","message":"a"}\nмусор\n{"type":"stage"')).toEqual([{ type: "warning", message: "a" }]);
    expect(p.push(',"stage":"demo","message":"m","progress":1}')).toEqual([]);
    expect(p.flush()).toEqual([{ type: "stage", stage: "demo", message: "m", progress: 1 }]);
  });
});
