"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown } from "./Dropdown";

const MODES = [
  {
    id: "keyword" as const,
    label: "Keyword",
    hint: "Search titles & metadata as typed",
  },
  {
    id: "interpret" as const,
    label: "Interpret",
    hint: "Turn a vibe into a real metadata query",
  },
];

export default function SearchBar({
  onSearch,
  loading,
  interpret,
  onSetInterpret,
}: {
  onSearch: (q: string) => void;
  loading: boolean;
  interpret: boolean;
  onSetInterpret: (on: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const modeWrap = useRef<HTMLDivElement>(null);

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

  const activeMode = interpret ? "interpret" : "keyword";

  return (
    <form
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
          aria-label="Search mode"
          className={`flex items-center gap-1.5 border-r border-ink px-4 text-[11px] tracking-[0.08em] ${
            interpret ? "bg-accent text-paper" : "invert-hover"
          }`}
        >
          {interpret ? "Interpret" : "Keyword"}
          <CaretDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-120 ${
              menuOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {menuOpen && (
          <div className="animate-pop absolute top-full left-0 z-30 mt-1 w-[248px] border border-ink bg-paper">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSetInterpret(m.id === "interpret");
                  setMenuOpen(false);
                }}
                aria-pressed={activeMode === m.id}
                className="invert-hover group/mode flex w-full items-start gap-2 px-3 py-2 text-left"
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

      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          interpret
            ? "Describe a vibe — try “misty atmospheric morning”"
            : "Search open-access art — try “monet mist” or “nocturne”"
        }
        className="w-full bg-paper px-4 py-3 text-[14px] outline-none placeholder:text-muted-foreground focus:bg-wash"
      />
      <button
        type="submit"
        disabled={loading}
        className="invert-hover shrink-0 border-l border-ink px-6 text-[13px] font-semibold disabled:opacity-40"
      >
        {loading ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
