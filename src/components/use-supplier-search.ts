"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchQuery } from "@/domain";
import { SearchClientError, streamSearch } from "@/lib/searchClient";
import type { CandidateEvent, ErrorCode, ResultEvent, SearchEvent, StageEvent, StageId } from "@/lib/searchEvents";

export type SearchState = {
  status: "idle" | "loading" | "done" | "error";
  /** Какие стадии уже приходили (по порядку). */
  stages: StageId[];
  stage: StageEvent | null;
  /** Последнее состояние каждого сайта-кандидата (по домену), в порядке появления. */
  candidates: CandidateEvent[];
  warnings: string[];
  progress: number;
  result: ResultEvent | null;
  error: { message: string; code: ErrorCode | "network" } | null;
};

export const IDLE: SearchState = { status: "idle", stages: [], stage: null, candidates: [], warnings: [], progress: 0, result: null, error: null };

/** Применяет событие потока к состоянию (чистая функция — удобно тестировать). */
export function reduceEvent(s: SearchState, e: SearchEvent): SearchState {
  switch (e.type) {
    case "stage":
      return { ...s, stage: e, stages: s.stages.includes(e.stage) ? s.stages : [...s.stages, e.stage], progress: Math.max(s.progress, e.progress) };
    case "candidate": {
      const i = s.candidates.findIndex((c) => c.domain === e.domain);
      const candidates = i < 0 ? [...s.candidates, e] : s.candidates.map((c, j) => (j === i ? { ...c, ...e } : c));
      return { ...s, candidates, progress: Math.max(s.progress, e.progress) };
    }
    case "warning":
      return { ...s, warnings: s.warnings.includes(e.message) ? s.warnings : [...s.warnings, e.message] };
    case "result":
      return { ...s, status: "done", result: e, progress: 1 };
    case "error":
      return { ...s, status: "error", error: { message: e.message, code: e.code } };
  }
}

/** Запуск поиска с отменой: новый запуск или размонтирование обрывают предыдущий поток. */
export function useSupplierSearch() {
  const [state, setState] = useState<SearchState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => (s.status === "loading" ? IDLE : s));
  }, []);

  const run = useCallback(async (query: SearchQuery) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ ...IDLE, status: "loading" });
    try {
      const result = await streamSearch(query, {
        signal: ctrl.signal,
        onEvent: (e) => {
          if (!ctrl.signal.aborted && e.type !== "result" && e.type !== "error") setState((s) => reduceEvent(s, e));
        },
      });
      if (!ctrl.signal.aborted) setState((s) => reduceEvent(s, result));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const e = err instanceof SearchClientError ? err : new SearchClientError("Не удалось выполнить поиск. Попробуйте ещё раз.", "failed");
      setState((s) => ({ ...s, status: "error", error: { message: e.message, code: e.code } }));
    }
  }, []);

  return { state, run, cancel };
}
