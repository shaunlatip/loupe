"use client";

import type { SourceId } from "@/lib/types";

const SHORT: Record<SourceId, string> = {
  aic: "AIC",
  cma: "CMA",
  met: "Met",
  rijks: "Rijks",
};

/** "relevance" is the unmodified fetch order — the default, unchanged behavior. */
export type SortMode = "relevance" | "lightest" | "darkest" | "hue" | "calmest";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "lightest", label: "Lightest" },
  { id: "darkest", label: "Darkest" },
  { id: "hue", label: "By hue" },
  { id: "calmest", label: "Calmest" },
];

export default function FilterBar({
  sources,
  enabled,
  onToggle,
  artist,
  onArtist,
  sort,
  onSort,
  heroOnly,
  onHeroToggle,
}: {
  sources: SourceId[];
  enabled: SourceId[];
  onToggle: (s: SourceId) => void;
  artist: string;
  onArtist: (v: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  heroOnly: boolean;
  onHeroToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {sources.map((source) => {
        const checked = enabled.includes(source);
        return (
          <label
            key={source}
            className="flex cursor-pointer select-none items-center gap-1.5 text-[12px]"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(source)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={`block h-3 w-3 border border-ink ${
                checked ? "bg-ink" : "bg-paper"
              }`}
            />
            {SHORT[source]}
          </label>
        );
      })}
      <input
        type="text"
        value={artist}
        onChange={(e) => onArtist(e.target.value)}
        placeholder="Artist"
        className="border border-ink bg-paper px-2 py-1 text-[12px] text-ink outline-none placeholder:text-muted-foreground focus:bg-wash"
      />
      <div className="flex items-center gap-2">
        <span className="caption">Sort</span>
        <div className="flex border border-ink">
          {SORTS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSort(s.id)}
              aria-pressed={sort === s.id}
              className={`px-2 py-1 text-[11px] ${i > 0 ? "border-l border-ink" : ""} ${
                sort === s.id ? "bg-accent text-paper" : "invert-hover"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onHeroToggle}
        aria-pressed={heroOnly}
        title="Landscape aspect ≥1.4 and width ≥2000px"
        className={`border border-ink px-2 py-1 text-[11px] ${
          heroOnly ? "bg-accent text-paper" : "invert-hover"
        }`}
      >
        Fits a hero
      </button>
    </div>
  );
}
