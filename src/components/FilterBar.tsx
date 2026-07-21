"use client";

import type { SourceId } from "@/lib/types";

const SHORT: Record<SourceId, string> = {
  aic: "AIC",
  cma: "CMA",
  met: "Met",
  rijks: "Rijks",
};

export default function FilterBar({
  sources,
  enabled,
  onToggle,
  artist,
  onArtist,
}: {
  sources: SourceId[];
  enabled: SourceId[];
  onToggle: (s: SourceId) => void;
  artist: string;
  onArtist: (v: string) => void;
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
    </div>
  );
}
