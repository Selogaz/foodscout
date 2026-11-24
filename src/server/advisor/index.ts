import { rankSuppliers } from "@/domain";
import {
  ADVISE_SYSTEM,
  AdviceLlmSchema,
  DRAFT_SYSTEM,
  DraftLlmSchema,
  adviseUserPrompt,
  assembleDraft,
  buildFacts,
  draftUserPrompt,
  fallbackAdvice,
  fallbackIntro,
  firstEmail,
  introIsValid,
  mailtoHref,
  mergeLlmAdvice,
  type Advice,
  type AdviseInput,
  type DraftResult,
} from "@/lib/advisor";
import type { DraftInput } from "@/lib/advisor";
import { DraftInputSchema } from "@/lib/advisor";
import type { ApiConfig, ApiState } from "../api";
import type { LlmProvider } from "../llm";

export type AssistContext = {
  config: ApiConfig;
  state: ApiState;
  /** null — ключа нет. */
  llm: LlmProvider | null;
  signal?: AbortSignal;
};

type Gate = { llm: LlmProvider } | { llm: null; reason: NonNullable<Advice["fallbackReason"]> };

/** Решает, можно ли звать модель: DEMO_MODE=on и отсутствие ключа дают детерминированный ответ без вызова. */
function gate(ctx: AssistContext, promptChars: number): Gate {
  if (ctx.config.demoMode === "on") return { llm: null, reason: "demo-mode" };
  if (!ctx.llm) return { llm: null, reason: "no-key" };
  if (promptChars > 16_000 || !ctx.state.assistDaily.tryTake()) return { llm: null, reason: "limit" };
  return { llm: ctx.llm };
}

/** Вызов с жёстким таймаутом: по его истечении — фолбэк. */
async function withTimeout<T>(ctx: AssistContext, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ctx.config.assistTimeoutMs);
  const onAbort = () => ac.abort();
  ctx.signal?.addEventListener("abort", onAbort);
  try {
    return await run(ac.signal);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

/** Рекомендация «кому написать первым». Скоринг считается заново на сервере: клиентскому баллу не доверяем. */
export async function runAdvise(input: AdviseInput, ctx: AssistContext): Promise<Advice> {
  const seen = new Set<string>();
  const unique = input.suppliers.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const facts = rankSuppliers(unique, input.query).map((r) => buildFacts(r, input.query));
  const user = adviseUserPrompt(facts, input.query);
  const g = gate(ctx, ADVISE_SYSTEM.length + user.length);
  if (!g.llm) return fallbackAdvice(facts, input.query, g.reason);
  try {
    const { data } = await withTimeout(ctx, (signal) =>
      g.llm.extractStructured({
        system: ADVISE_SYSTEM,
        user,
        maxAttempts: 1,
        schema: AdviceLlmSchema,
        schemaName: "advise_contact_order",
        temperature: 0.2,
        maxTokens: 1500,
        signal,
      }),
    );
    return mergeLlmAdvice(data, facts, input.query);
  } catch (e) {
    console.error("Не удалось построить рекомендацию", e);
    return fallbackAdvice(facts, input.query, "failed");
  }
}

/** Черновик запроса КП под одного поставщика: шаблон + вступление от модели (с проверкой). */
export async function runDraft(raw: DraftInput, ctx: AssistContext): Promise<DraftResult> {
  const input = DraftInputSchema.parse(raw);
  const [ranked] = rankSuppliers([input.supplier], input.query);
  const facts = buildFacts(ranked, input.query);
  const finish = (intro: string, source: DraftResult["source"], fallbackReason: DraftResult["fallbackReason"]): DraftResult => {
    const { subject, body } = assembleDraft(facts, input.query, { intro, volume: input.volume, city: input.deliveryCity });
    const email = firstEmail(input.supplier);
    return { subject, body, email, mailto: email ? mailtoHref(email, subject, body) : null, source, fallbackReason };
  };
  const user = draftUserPrompt(facts, input.query);
  const g = gate(ctx, DRAFT_SYSTEM.length + user.length);
  if (!g.llm) return finish(fallbackIntro(facts, input.query), "fallback", g.reason);
  try {
    const { data } = await withTimeout(ctx, (signal) =>
      g.llm.extractStructured({
        system: DRAFT_SYSTEM,
        user,
        maxAttempts: 1,
        schema: DraftLlmSchema,
        schemaName: "draft_request_intro",
        temperature: 0.4,
        maxTokens: 400,
        signal,
      }),
    );
    if (!introIsValid(data.intro, facts)) return finish(fallbackIntro(facts, input.query), "fallback", "failed");
    return finish(data.intro, "llm", null);
  } catch (e) {
    console.error("Не удалось построить черновик", e);
    return finish(fallbackIntro(facts, input.query), "fallback", "failed");
  }
}
