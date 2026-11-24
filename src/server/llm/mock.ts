import {
  LlmError,
  type LlmMessageRequest,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
  type TextResult,
} from "./types";

/** Обработчик мок-ответа: по имени схемы и тексту запроса возвращает «ответ модели» (до валидации). */
export type MockStructuredHandler = (req: { schemaName: string; system: string; user: string }) => unknown | Promise<unknown>;
export type MockTextHandler = (req: { system: string; user: string }) => string | Promise<string>;

/**
 * Детерминированный провайдер для тестов и офлайна: ответы берутся из фикстур.
 * Ответ проходит ту же Zod-валидацию, что и у реальной модели, — тесты ловят расхождение схем.
 */
export class MockProvider implements LlmProvider {
  readonly model = "mock";
  readonly calls: { kind: "structured" | "text"; schemaName?: string; user: string }[] = [];

  constructor(
    private readonly structured: MockStructuredHandler,
    private readonly text: MockTextHandler = () => "",
  ) {}

  async extractStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ kind: "structured", schemaName: req.schemaName, user: req.user });
    if (req.signal?.aborted) throw new LlmError("Запрос отменён", "timeout");
    const raw = await this.structured({ schemaName: req.schemaName, system: req.system, user: req.user });
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmError(`Мок вернул ответ не по схеме ${req.schemaName}: ${parsed.error.message}`, "bad-response");
    }
    return { data: parsed.data, usage: { inputTokens: Math.ceil(req.user.length / 4), outputTokens: 100 }, attempts: 1 };
  }

  async generateText(req: LlmMessageRequest): Promise<TextResult> {
    this.calls.push({ kind: "text", user: req.user });
    return { text: await this.text(req), usage: { inputTokens: Math.ceil(req.user.length / 4), outputTokens: 50 } };
  }
}
