import type { z } from "zod";

/** Расход токенов одного вызова модели. */
export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmMessageRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type StructuredRequest<T> = LlmMessageRequest & {
  /** Схема ответа: по ней строится JSON-схема для модели и валидируется ответ. */
  schema: z.ZodType<T>;
  /** Короткое латинское имя схемы (передаётся модели и используется моками). */
  schemaName: string;
};

export type StructuredResult<T> = { data: T; usage: LlmUsage; attempts: number };
export type TextResult = { text: string; usage: LlmUsage };

/**
 * Провайдер LLM. Конкретная модель и endpoint — конфигурация адаптера,
 * пайплайн знает только этот интерфейс.
 */
export interface LlmProvider {
  /** Идентификатор модели (для логов и расчёта цены). */
  readonly model: string;
  /** Ответ строго по Zod-схеме; при невалидном ответе адаптер делает ретрай, потом бросает LlmError. */
  extractStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  generateText(req: LlmMessageRequest): Promise<TextResult>;
}

export type LlmErrorKind = "auth" | "billing" | "rate-limit" | "timeout" | "bad-response" | "http" | "network";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly status?: number,
    /** Токены, потраченные до ошибки (для учёта стоимости). */
    readonly usage?: LlmUsage,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const sumUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };
