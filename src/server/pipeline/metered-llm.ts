import {
  LlmError,
  type LlmMessageRequest,
  type LlmProvider,
  type LlmUsage,
  type StructuredRequest,
  type StructuredResult,
  type TextResult,
  sumUsage,
  ZERO_USAGE,
} from "../llm/types";

/** Обёртка, которая считает токены и вызовы одного прогона (для статистики и цены поиска). */
export class MeteredLlm implements LlmProvider {
  usage: LlmUsage = ZERO_USAGE;
  calls = 0;
  constructor(private readonly inner: LlmProvider) {}
  get model() {
    return this.inner.model;
  }

  private track(u: LlmUsage | undefined) {
    this.calls += 1;
    if (u) this.usage = sumUsage(this.usage, u);
  }

  async extractStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    try {
      const r = await this.inner.extractStructured(req);
      this.track(r.usage);
      return r;
    } catch (e) {
      this.track(e instanceof LlmError ? e.usage : undefined);
      throw e;
    }
  }

  async generateText(req: LlmMessageRequest): Promise<TextResult> {
    const r = await this.inner.generateText(req);
    this.track(r.usage);
    return r;
  }
}
