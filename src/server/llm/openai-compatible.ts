import { z } from "zod";
import {
  LlmError,
  type LlmMessageRequest,
  type LlmProvider,
  type LlmUsage,
  type StructuredRequest,
  type StructuredResult,
  type TextResult,
  sumUsage,
} from "./types";

/** Как просить у модели структурированный ответ. */
export type StructuredMode = "json_schema" | "json_object";

export type OpenAiCompatibleConfig = {
  /** Например https://ai.api.cloud.yandex.net/v1 */
  baseUrl: string;
  apiKey: string;
  /** Полный URI модели (gpt://<folder>/<model>/latest) или любой id, который понимает endpoint. */
  model: string;
  /** Заголовок авторизации: AI Studio принимает «Api-Key <ключ>», большинство других — «Bearer <ключ>». */
  authScheme?: "Api-Key" | "Bearer";
  /** Идёт в заголовок OpenAI-Project (для AI Studio — folder_id). */
  project?: string;
  structuredMode?: StructuredMode;
  /**
   * reasoning_effort для моделей с режимом рассуждений (Qwen3, DeepSeek). Для извлечения
   * по цитатам рассуждения не нужны: «none» в разы дешевле и быстрее. null — не передавать.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high" | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Вынимает JSON из ответа модели: снимает блок рассуждений и markdown-ограждение. */
export function extractJsonText(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

function shortIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(корень)"}: ${i.message}`)
    .join("; ");
}

/** Адаптер любого OpenAI-совместимого Chat Completions endpoint (AI Studio, vLLM, OpenRouter…). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly model: string;
  private readonly cfg: Required<Omit<OpenAiCompatibleConfig, "project" | "reasoningEffort">> & {
    project?: string;
    reasoningEffort: OpenAiCompatibleConfig["reasoningEffort"];
  };

  constructor(cfg: OpenAiCompatibleConfig) {
    this.model = cfg.model;
    this.cfg = {
      authScheme: "Bearer",
      structuredMode: "json_schema",
      reasoningEffort: null,
      timeoutMs: 90_000,
      fetchImpl: fetch,
      ...cfg,
      baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
    };
  }

  private async chat(
    messages: ChatMessage[],
    req: LlmMessageRequest,
    responseFormat?: unknown,
  ): Promise<{ content: string; usage: LlmUsage }> {
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `${this.cfg.authScheme} ${this.cfg.apiKey}`,
    };
    if (this.cfg.project) headers["OpenAI-Project"] = this.cfg.project;
    let res: Response;
    try {
      res = await this.cfg.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: req.temperature ?? 0,
          max_tokens: req.maxTokens ?? 2000,
          ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new LlmError(`LLM не ответила за ${this.cfg.timeoutMs} мс`, "timeout");
      }
      throw new LlmError(`Сетевая ошибка LLM: ${(e as Error).message}`, "network");
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 500);
      const kind =
        res.status === 401 || res.status === 403 ? "auth"
        : res.status === 402 ? "billing"
        : res.status === 429 ? "rate-limit"
        : "http";
      throw new LlmError(`LLM HTTP ${res.status}: ${body}`, kind, res.status);
    }
    const json = (await res.json()) as ChatResponse;
    const content = json.choices?.[0]?.message?.content ?? "";
    return {
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }

  async generateText(req: LlmMessageRequest): Promise<TextResult> {
    const { content, usage } = await this.chat(
      [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      req,
    );
    return { text: content.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), usage };
  }

  async extractStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const responseFormat =
      this.cfg.structuredMode === "json_schema"
        ? {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: z.toJSONSchema(req.schema, { io: "input" }) },
          }
        : { type: "json_object" };
    const messages: ChatMessage[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ];
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    let lastError = "";
    for (let attempt = 1; attempt <= (req.maxAttempts ?? 2); attempt++) {
      const r = await this.chat(messages, req, responseFormat);
      usage = sumUsage(usage, r.usage);
      const text = extractJsonText(r.content);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastError = "ответ не является JSON";
        messages.push(
          { role: "assistant", content: r.content.slice(0, 4000) },
          { role: "user", content: "Ответ не разобрался как JSON. Верни только один JSON-объект по схеме, без пояснений." },
        );
        continue;
      }
      const check = req.schema.safeParse(parsed);
      if (check.success) return { data: check.data, usage, attempts: attempt };
      lastError = shortIssues(check.error);
      messages.push(
        { role: "assistant", content: text.slice(0, 4000) },
        { role: "user", content: `JSON не прошёл проверку схемы: ${lastError}. Исправь и верни только JSON-объект.` },
      );
    }
    throw new LlmError(`Модель не вернула валидный JSON: ${lastError}`, "bad-response", undefined, usage);
  }
}
