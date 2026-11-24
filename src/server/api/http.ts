/** Общие мелочи HTTP-роутов помощника (поиск держит свои копии в route.ts). */

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) {
  return Response.json({ type: "error", code, message, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const ASSIST_BODY_BYTES = 128 * 1024;

/** Проверяем и поток без Content-Length, до разбора JSON и создания объектов поставщиков. */
export async function readAssistBody(req: Request): Promise<{ data: unknown } | { error: Response }> {
  const tooLarge = () => ({ error: jsonError(413, "invalid_request", "Тело запроса слишком велико.") });
  if (Number(req.headers.get("content-length")) > ASSIST_BODY_BYTES) return tooLarge();
  const reader = req.body?.getReader();
  try {
    if (!reader) throw new Error("Пустое тело");
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ASSIST_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return { data: JSON.parse(text + decoder.decode()) };
  } catch {
    return { error: jsonError(400, "invalid_request", "Тело запроса должно быть корректным JSON.") };
  } finally {
    reader?.releaseLock();
  }
}
