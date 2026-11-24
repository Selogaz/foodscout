import { z } from "zod";
import { SearchQuerySchema } from "@/domain";
import type { ErrorEvent, SearchEvent } from "@/lib/searchEvents";
import { isRecordedExample } from "@/server/api/demo";
import { createRuntimeContext } from "@/server/api/runtime";
import { executeSearch } from "@/server/api/search-service";

// Среда выполнения — nodejs (по умолчанию; явный `runtime` несовместим с cacheComponents в next.config).
/** Живой поиск ≈32–37 с; запас на медленные сайты и демо-фолбэк. Должно быть больше LIVE_SEARCH_TIMEOUT_S. */
export const maxDuration = 120;

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

function jsonError(status: number, error: ErrorEvent, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) {
  return Response.json({ ...error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * POST /api/search — тело: SearchQuery (JSON). Ответ: поток NDJSON, по строке на событие
 * (stage / candidate / warning, в конце result или error). Ошибки до старта потока — обычный JSON
 * с кодом 400 (невалидное тело) или 429 (слишком частые запросы).
 */
export async function POST(req: Request) {
  const ctx = createRuntimeContext(req.signal);
  const config = ctx.config;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, { type: "error", code: "invalid_request", message: "Тело запроса должно быть корректным JSON." });
  }
  const parsed = SearchQuerySchema.safeParse(body, { error: z.locales.ru().localeError });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(тело)", message: i.message }));
    const first = issues[0];
    return jsonError(
      400,
      { type: "error", code: "invalid_request", message: `Некорректный запрос: ${first.path} — ${first.message}${issues.length > 1 ? ` (и ещё ${issues.length - 1})` : ""}.` },
      { issues },
    );
  }

  // Запрос из записанных данных (режим «только демо» или точный пример в auto) ничего не стоит: лимит здесь только
  // мешал бы проверяющему пройти по примерам подряд. Живой поиск за лимитом остаётся.
  const limit = config.demoMode === "on" || (config.demoMode === "auto" && isRecordedExample(parsed.data)) ? { ok: true as const } : ctx.state.limiter.take(clientIp(req));
  if (!limit.ok) {
    return jsonError(
      429,
      { type: "error", code: "rate_limited", message: `Слишком много запросов: не больше ${config.rateLimitMax} поисков в минуту. Повторите через ${limit.retryAfterS} с.` },
      { retryAfterS: limit.retryAfterS },
      { "Retry-After": String(limit.retryAfterS) },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: SearchEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await executeSearch(parsed.data, emit, ctx);
      } catch {
        emit({ type: "error", code: "failed", message: "Не удалось выполнить поиск. Попробуйте ещё раз чуть позже." });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* поток уже закрыт клиентом */
        }
      }
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
