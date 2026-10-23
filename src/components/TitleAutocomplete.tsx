"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogSuggestion } from "@/lib/catalog-types";

function isSuggestion(value: unknown): value is CatalogSuggestion {
  if (!value || typeof value !== "object") return false;
  const item = value as CatalogSuggestion;
  return typeof item.title === "string" && item.title.trim().length > 0 &&
    Array.isArray(item.platforms) && item.platforms.every((platform) => typeof platform === "string") &&
    (item.genre === null || typeof item.genre === "string") &&
    (item.releaseYear === null || Number.isInteger(item.releaseYear)) &&
    (item.estimatedHours === null || (typeof item.estimatedHours === "number" && Number.isFinite(item.estimatedHours) && item.estimatedHours > 0)) &&
    (item.coverUrl === null || (typeof item.coverUrl === "string" && /^https?:\/\//i.test(item.coverUrl)));
}

export default function TitleAutocomplete({ id, defaultValue = "", ariaLabel, onSelect, onTitleChange }: {
  id: string;
  defaultValue?: string;
  ariaLabel?: string;
  onSelect: (suggestion: CatalogSuggestion) => void;
  onTitleChange: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogSuggestion[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);
  // Invalidated synchronously, before effect cleanup, so even a response arriving
  // between an input event and the next render cannot revive an old menu.
  const generation = useRef(0);
  const listId = `${id}-suggestions`;
  const statusId = `${id}-status`;
  const open = suggestions.length > 0;

  const dismiss = useCallback(() => {
    generation.current++;
    setQuery(null);
    setSuggestions([]);
    setHighlighted(-1);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (query === null || query.trim().length < 2) return;
    const current = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/search?${new URLSearchParams({ q: query.trim() })}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!controller.signal.aborted && current === generation.current) {
          setSuggestions(Array.isArray(payload) ? payload.filter(isSuggestion).slice(0, 8) : []);
        }
      } catch { /* Catalog lookup is optional; freeform submission stays available. */ }
      finally {
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      }
    }, 275);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [dismiss]);

  useEffect(() => {
    if (highlighted >= 0) rootRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function select(suggestion: CatalogSuggestion) {
    setValue(suggestion.title);
    dismiss();
    onSelect(suggestion);
    inputRef.current?.focus();
  }

  return (
    <div className="title-autocomplete" ref={rootRef}>
      <input
        ref={inputRef}
        id={id}
        autoComplete="off"
        maxLength={120}
        name="title"
        placeholder="What are you playing next?"
        required
        value={value}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        aria-describedby={statusId}
        onChange={(event) => {
          generation.current++;
          setValue(event.target.value);
          setSuggestions([]);
          setHighlighted(-1);
          setLoading(event.target.value.trim().length >= 2);
          setQuery(event.target.value);
          onTitleChange();
        }}
        onFocus={() => {
          if (query === null && value.trim().length >= 2) {
            setQuery(value);
            setLoading(true);
          }
        }}
        onBlur={dismiss}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && (open || loading || query !== null)) {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          } else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setHighlighted((index) => event.key === "ArrowDown"
              ? (index + 1) % suggestions.length
              : (index <= 0 ? suggestions.length : index) - 1);
          } else if (event.key === "Enter" && open && highlighted >= 0) {
            event.preventDefault();
            select(suggestions[highlighted]);
          }
        }}
      />
      {open && (
        <ul className="title-suggestions" id={listId} role="listbox" aria-label="Game title suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.title}:${suggestion.releaseYear}:${index}`}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={highlighted === index}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setHighlighted(index)}
              onClick={() => select(suggestion)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(suggestion); }
              }}
            >
              <span className="title-suggestion-cover" aria-hidden="true">
                <span>◇</span>
                {/* Small optional provider thumbnail, with a persistent placeholder on failure. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {suggestion.coverUrl && <img src={suggestion.coverUrl} alt="" width={40} height={56} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
              </span>
              <span className="title-suggestion-copy">
                <span className="title-suggestion-title">{suggestion.title}{suggestion.releaseYear && <small> · {suggestion.releaseYear}</small>}</span>
                <span className="title-suggestion-summary">{[suggestion.platforms[0], suggestion.genre].filter(Boolean).join(" · ") || "Details unavailable"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <span className="title-autocomplete-status" id={statusId} role="status">
        {loading ? "Searching titles…" : open ? `${suggestions.length} suggestions. Use up and down arrows to explore, Enter to select, or keep your own title.` : "Enter any title, or choose a suggestion when available."}
      </span>
    </div>
  );
}
