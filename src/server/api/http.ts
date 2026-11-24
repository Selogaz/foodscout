/** Общие мелочи HTTP-роутов помощника (поиск держит свои копии в route.ts). */

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) {
  return Response.json({ type: "error", code, message, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
