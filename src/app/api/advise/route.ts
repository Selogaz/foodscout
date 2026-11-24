import { z } from "zod";
import { AdviseInputSchema } from "@/lib/advisor";
import { runAdvise } from "@/server/advisor";
import { clientIp, jsonError } from "@/server/api/http";
import { createRuntimeContext } from "@/server/api/runtime";

export const maxDuration = 40;

/**
 * POST /api/advise — тело: { query, suppliers[1..8] }. Ответ: Advice (порядок контакта, «почему» со ссылками
 * на поля, «что уточнить»). Без ключа и в DEMO_MODE=on — детерминированный фолбэк без вызова модели.
 */
export async function POST(req: Request) {
  const ctx = createRuntimeContext(req.signal);
  const limit = ctx.state.assistLimiter.take(clientIp(req));
  if (!limit.ok) {
    return jsonError(429, "rate_limited", `Слишком много запросов. Повторите через ${limit.retryAfterS} с.`, { retryAfterS: limit.retryAfterS }, { "Retry-After": String(limit.retryAfterS) });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_request", "Тело запроса должно быть корректным JSON.");
  }
  const parsed = AdviseInputSchema.safeParse(body, { error: z.locales.ru().localeError });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, "invalid_request", `Некорректный запрос: ${first.path.join(".") || "(тело)"} — ${first.message}.`);
  }
  const advice = await runAdvise(parsed.data, { config: ctx.config, state: ctx.state, llm: ctx.llm, signal: req.signal });
  return Response.json(advice, { headers: { "Cache-Control": "no-store" } });
}
