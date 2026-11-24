"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MAX_NOTE_LENGTH } from "@/lib/shortlistStore";

const DEBOUNCE_MS = 600;

/** Заметка с автосохранением: пишет через паузу в наборе, при уходе из поля и при закрытии карточки. */
export function NoteEditor({ id, label, value, onSave }: { id: string; label: string; value: string; onSave: (id: string, note: string) => void }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const savedRef = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (draftRef.current !== savedRef.current) {
      savedRef.current = draftRef.current;
      onSave(id, draftRef.current);
    }
  }, [id, onSave]);

  // Не потерять набранное при уходе со страницы / удалении карточки из списка.
  useEffect(() => flush, [flush]);

  const change = (v: string) => {
    setDraft(v);
    draftRef.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  };

  const saved = draft === value;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`note-${id}`} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={`note-${id}`}
        value={draft}
        maxLength={MAX_NOTE_LENGTH}
        rows={3}
        placeholder="С кем говорили, что обещали, что уточнить…"
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
      />
      <p className="text-xs text-muted-foreground" role="status" data-testid="note-state">
        {saved ? (draft ? "Сохранено в браузере" : "Заметка хранится только в этом браузере") : "Сохраняется…"}
      </p>
    </div>
  );
}
