import type { SearchQueryInput } from "@/domain";
import type { ErrorCode, ResultEvent, SearchEvent } from "./searchEvents";

export type { SearchEvent, ResultEvent } from "./searchEvents";

/** Ошибка поиска с понятным русским сообщением (его можно показывать как есть). */
export class SearchClientError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | "network",
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "SearchClientError";
  }
}

/** Собирает строки NDJSON из произвольно порезанных чанков. */
export class NdjsonLineParser {
  private buf = "";
  push(chunk: string): SearchEvent[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    return lines.flatMap((l) => parseLine(l));
  }
  flush(): SearchEvent[] {
    const rest = this.buf;
    this.buf = "";
    return parseLine(rest);
  }
}

function parseLine(line: string): SearchEvent[] {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line) as SearchEvent];
  } catch {
    return []; // битая строка не должна ронять весь поиск
  }
}

export type StreamSearchOptions = {
  /** Вызывается на каждое событие по мере поступления (stage, candidate, warning, result). */
  onEvent?: (e: SearchEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  url?: string;
};

/**
 * Запускает поиск и читает поток. Возвращает финальный result; событие error и HTTP-ошибки
 * (400, 429, сеть) превращаются в SearchClientError с русским сообщением.
 */
export async function streamSearch(query: SearchQueryInput, opts: StreamSearchOptions = {}): Promise<ResultEvent> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url ?? "/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: opts.signal,
    });
  } catch {
    if (opts.signal?.aborted) throw new SearchClientError("Поиск отменён", "aborted");
    throw new SearchClientError("Нет связи с сервером. Проверьте интернет и попробуйте снова.", "network");
  }

  if (!res.ok) {
    let data: { code?: ErrorCode; message?: string; issues?: { path: string; message: string }[] } = {};
    try {
      data = await res.json();
    } catch {
      /* тело не JSON */
    }
    throw new SearchClientError(data.message ?? `Сервер ответил с ошибкой ${res.status}.`, data.code ?? "failed", data.issues);
  }
  if (!res.body) throw new SearchClientError("Сервер не передал поток результатов.", "failed");

  const parser = new NdjsonLineParser();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let result: ResultEvent | null = null;
  let failure: SearchClientError | null = null;
  const handle = (events: SearchEvent[]) => {
    for (const e of events) {
      opts.onEvent?.(e);
      if (e.type === "result") result = e;
      else if (e.type === "error") failure = new SearchClientError(e.message, e.code);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    handle(parser.push(decoder.decode()));
    handle(parser.flush());
  } catch {
    if (opts.signal?.aborted) throw new SearchClientError("Поиск отменён", "aborted");
    throw new SearchClientError("Соединение прервалось до конца поиска. Попробуйте снова.", "network");
  }
  if (failure) throw failure;
  if (!result) throw new SearchClientError("Поиск завершился без результата. Попробуйте снова.", "failed");
  return result;
}
