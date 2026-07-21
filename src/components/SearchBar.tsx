"use client";

import { useState } from "react";

export default function SearchBar({
  onSearch,
  loading,
  interpret,
  onToggleInterpret,
}: {
  onSearch: (q: string) => void;
  loading: boolean;
  interpret: boolean;
  onToggleInterpret: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex w-full items-stretch border border-ink"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSearch(value.trim());
      }}
    >
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
        type="button"
        onClick={onToggleInterpret}
        aria-pressed={interpret}
        title="Translate vague ideas into real metadata queries"
        className={`shrink-0 border-l border-ink px-4 text-[11px] tracking-[0.08em] ${
          interpret ? "bg-accent text-paper" : "invert-hover"
        }`}
      >
        Interpret
      </button>
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
