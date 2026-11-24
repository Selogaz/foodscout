import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiStudioModelUri, createLlmProviderFromEnv } from "./index";
import { extractJsonText, OpenAiCompatibleProvider } from "./openai-compatible";
import { llmCostRub, modelShortName } from "./pricing";
import { LlmError } from "./types";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeApi(replies: (string | { status: number; body: string })[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (typeof r !== "string") return new Response(r.body, { status: r.status });
    return Response.json({ choices: [{ message: { content: r } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const Schema = z.object({ name: z.string(), qty: z.number().nullable() });

const provider = (fetchImpl: typeof fetch) =>
  new OpenAiCompatibleProvider({
    baseUrl: "https://llm.example.test/v1/",
    apiKey: "test-key",
    model: "gpt://folder/qwen3.6-35b-a3b/latest",
    authScheme: "Api-Key",
    project: "folder",
    reasoningEffort: "none",
    fetchImpl,
  });

describe("OpenAiCompatibleProvider", () => {
  it("отправляет json_schema, авторизацию и reasoning_effort; разбирает ответ", async () => {
    const api = fakeApi(['{"name":"Тест","qty":5}']);
    const r = await provider(api.fetchImpl).extractStructured({ system: "s", user: "u", schema: Schema, schemaName: "t" });
    expect(r.data).toEqual({ name: "Тест", qty: 5 });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    const c = api.calls[0];
    expect(c.url).toBe("https://llm.example.test/v1/chat/completions");
    expect(c.headers.Authorization).toBe("Api-Key test-key");
    expect(c.headers["OpenAI-Project"]).toBe("folder");
    expect(c.body.reasoning_effort).toBe("none");
    expect(c.body.temperature).toBe(0);
    expect((c.body.response_format as { type: string }).type).toBe("json_schema");
  });

  it("ответ не по схеме → один ретрай с описанием ошибки", async () => {
    const api = fakeApi(['{"name":"Тест","qty":"пять"}', '```json\n{"name":"Тест","qty":null}\n```']);
    const r = await provider(api.fetchImpl).extractStructured({ system: "s", user: "u", schema: Schema, schemaName: "t" });
    expect(r.data).toEqual({ name: "Тест", qty: null });
    expect(r.attempts).toBe(2);
    expect(r.usage.inputTokens).toBe(200);
    const msgs = api.calls[1].body.messages as { role: string; content: string }[];
    expect(msgs.at(-1)?.content).toMatch(/не прошёл проверку схемы/);
  });

  it("одна разрешённая попытка не расходует бюджет на повтор", async () => {
    const api = fakeApi(["не JSON"]);
    await expect(provider(api.fetchImpl).extractStructured({
      system: "s", user: "u", schema: Schema, schemaName: "t", maxAttempts: 1,
    })).rejects.toMatchObject({ kind: "bad-response" });
    expect(api.calls).toHaveLength(1);
  });

  it("два невалидных ответа → LlmError bad-response с учётом токенов", async () => {
    const api = fakeApi(["не json", "опять не json"]);
    const err = await provider(api.fetchImpl)
      .extractStructured({ system: "s", user: "u", schema: Schema, schemaName: "t" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("bad-response");
    expect(err.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("HTTP 401/402/429 размечаются по виду ошибки", async () => {
    for (const [status, kind] of [[401, "auth"], [403, "auth"], [402, "billing"], [429, "rate-limit"], [500, "http"]] as const) {
      const api = fakeApi([{ status, body: "{}" }]);
      await expect(provider(api.fetchImpl).generateText({ system: "s", user: "u" })).rejects.toMatchObject({ kind, status });
    }
  });

  it("extractJsonText снимает рассуждения и ограждение", () => {
    expect(extractJsonText('<think>хм</think>\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonText('Вот ответ: {"a":{"b":2}} — готово')).toBe('{"a":{"b":2}}');
  });
});

describe("конфигурация из окружения", () => {
  it("без ключа живой режим недоступен", () => {
    expect(createLlmProviderFromEnv({})).toBeNull();
    expect(createLlmProviderFromEnv({ YANDEX_API_KEY: "k" })).toBeNull();
  });
  it("модель по короткому имени превращается в URI AI Studio", () => {
    const p = createLlmProviderFromEnv({ YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f1", LLM_MODEL: "aliceai-llm" });
    expect(p?.model).toBe("gpt://f1/aliceai-llm/latest");
    expect(aiStudioModelUri("gpt://x/y/rc", "f")).toBe("gpt://x/y/rc");
    expect(aiStudioModelUri("qwen3.6-35b-a3b/rc", "f")).toBe("gpt://f/qwen3.6-35b-a3b/rc");
  });
  it("другой OpenAI-совместимый endpoint берёт ключ из LLM_API_KEY", () => {
    const p = createLlmProviderFromEnv({ LLM_BASE_URL: "https://openrouter.example/v1", LLM_API_KEY: "k", LLM_MODEL: "m" });
    expect(p?.model).toBe("m");
  });
  it("цена считается по короткому имени модели", () => {
    expect(modelShortName("gpt://f/deepseek-v4.1-flash/latest")).toBe("deepseek-v4.1-flash");
    expect(llmCostRub("gpt://f/deepseek-v4.1-flash/latest", { inputTokens: 10_000, outputTokens: 2_000 })).toBeCloseTo(4);
    expect(llmCostRub("unknown", { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
