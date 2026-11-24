"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_TAG_LENGTH, MAX_TAGS, normalizeTag } from "@/lib/shortlistStore";

export function TagsEditor({ id, name, tags, onChange }: { id: string; name: string; tags: readonly string[]; onChange: (id: string, tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = normalizeTag(draft);
    setDraft("");
    if (t && tags.length < MAX_TAGS && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange(id, [...tags, t]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`tag-${id}`} className="text-sm font-medium">
        Теги
      </label>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Добавленные теги: ${name}`}>
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground">
              {t}
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-foreground/10"
                aria-label={`Убрать тег ${t}`}
                onClick={() => onChange(id, tags.filter((x) => x !== t))}
              >
                <XIcon aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={`tag-${id}`}
        value={draft}
        maxLength={MAX_TAG_LENGTH}
        disabled={tags.length >= MAX_TAGS}
        placeholder={tags.length >= MAX_TAGS ? "Достигнут предел тегов" : "Добавить тег и нажать Enter"}
        onChange={(e) => setDraft(e.target.value.replace(",", ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
