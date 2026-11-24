import type { Advice, AdviseInput, DraftInput, DraftResult } from "@/lib/advisor";

/** Ошибка помощника с понятным русским текстом (его можно показывать как есть). */
export class AssistError extends Error {}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    if (signal?.aborted) throw new AssistError("Запрос отменён");
    throw new AssistError("Нет связи с сервером. Проверьте интернет и попробуйте снова.");
  }
  if (!res.ok) {
    let message = `Сервер ответил с ошибкой ${res.status}.`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      /* тело не JSON */
    }
    throw new AssistError(message);
  }
  return (await res.json()) as T;
}

export const requestAdvice = (input: AdviseInput, signal?: AbortSignal) => post<Advice>("/api/advise", input, signal);
export const requestDraft = (input: DraftInput, signal?: AbortSignal) => post<DraftResult>("/api/draft-request", input, signal);
