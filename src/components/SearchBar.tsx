"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown } from "./Dropdown";

const MODES = [
  {
    id: "keyword" as const,
    label: "Keyword",
    hint: "Titles, artists and metadata, as typed",
  },
  {
    id: "interpret" as const,
    label: "Interpret",
    hint: "A mood, compiled into a real museum query",
  },
];

export default function SearchBar({
  onSearch,
  onClear,
  loading,
  interpret,
  onSetInterpret,
}: {
  onSearch: (q: string) => void;
  /** the field was emptied via the clear button — callers reset results */
  onClear?: () => void;
  loading: boolean;
  interpret: boolean;
  onSetInterpret: (on: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const modeWrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modeWrap.current && !modeWrap.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // "/" focuses the field from anywhere on the page (unless already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const activeMode = interpret ? "interpret" : "keyword";

  return (
    <form
      role="search"
      className="flex w-full items-stretch border border-ink"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSearch(value.trim());
      }}
    >
      {/* Mode selector — leads the field, so the reading order is
          "[mode] search [terms]". Two modes: Keyword (raw passthrough) and
          Interpret (vibe → compiled query). */}
      <div ref={modeWrap} className="relative flex shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Search mode"
          className={`press-none flex items-center gap-1.5 border-r border-ink px-4 text-[11px] tracking-[0.08em] ${
            interpret ? "bg-accent text-paper" : "invert-hover"
          }`}
        >
          {interpret ? "Interpret" : "Keyword"}
          <CaretDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
              menuOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="animate-pop absolute top-full left-0 z-30 mt-1 w-[260px] border border-ink bg-paper"
          >
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={activeMode === m.id}
                onClick={() => {
                  onSetInterpret(m.id === "interpret");
                  setMenuOpen(false);
                  input.current?.focus();
                }}
                className="invert-hover press-none group/mode flex w-full items-start gap-2 px-3 py-2 text-left focus-visible:outline-offset-[-2px]"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 block h-3 w-3 shrink-0 border border-current ${
                    activeMode === m.id ? "bg-current" : "bg-transparent"
                  }`}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-medium">{m.label}</span>
                  <span className="caption group-hover/mode:text-paper">
                    {m.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative flex min-w-0 flex-1">
        <input
          ref={input}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label={interpret ? "Describe a mood" : "Search"}
          placeholder={
            interpret
              ? "Describe a mood. “misty morning”, “dark ground for white text”"
              : "Search titles, artists, keywords. “nocturne”, “monet mist”"
          }
          className="w-full bg-paper py-3 pr-10 pl-4 text-[14px] outline-none placeholder:text-muted-foreground focus:bg-wash"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue("");
              onClear?.();
              input.current?.focus();
            }}
            className="animate-fade absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[16px] leading-none text-muted-foreground hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="invert-hover shrink-0 border-l border-ink px-6 text-[13px] font-semibold disabled:opacity-40"
      >
        {loading ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
