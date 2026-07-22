"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Artwork, SourceError } from "@/lib/types";
import ArtworkCard from "./ArtworkCard";
import { sourceLabel } from "./SourceBadge";

/**
 * Column count that tracks the same breakpoints the old CSS multi-column used
 * (Tailwind md = 48rem → 3, xl = 80rem → 4, else 2). useSyncExternalStore on
 * matchMedia so it re-renders on resize without a layout-thrash effect. The
 * grid only renders client-side after a fetch, so the server snapshot (2) is a
 * formality that never paints.
 */
function useColumnCount(): number {
  return useSyncExternalStore(
    (cb) => {
      const wide = window.matchMedia("(min-width: 80rem)");
      const mid = window.matchMedia("(min-width: 48rem)");
      wide.addEventListener("change", cb);
      mid.addEventListener("change", cb);
      return () => {
        wide.removeEventListener("change", cb);
        mid.removeEventListener("change", cb);
      };
    },
    () => {
      if (window.matchMedia("(min-width: 80rem)").matches) return 4;
      if (window.matchMedia("(min-width: 48rem)").matches) return 3;
      return 2;
    },
    () => 2,
  );
}

/**
 * Distribute artworks into k columns by placing each into the currently
 * shortest column (ties break left). Reading order becomes near-perfect
 * left-to-right across rows — unlike CSS multi-column, which fills each column
 * top-to-bottom so a light→dark sort reads *down* not *across*. Column heights
 * are estimated from the known aspect ratio (Met lacks dims → the 4:5
 * portrait-skewed fallback, matching ArtworkCard); the estimate only decides
 * placement — real height is still reserved per-card via aspectRatio, so the
 * no-reflow behavior holds.
 */
function distribute(artworks: Artwork[], k: number): Artwork[][] {
  const cols: Artwork[][] = Array.from({ length: k }, () => []);
  const heights = new Array(k).fill(0);
  for (const a of artworks) {
    const { width, height } = a.dims ?? {};
    const ratio = width && height ? width / height : 0.8;
    // 300px nominal column width / ratio = image height, + caption + margin.
    const est = 300 / ratio + 54 + 32;
    let min = 0;
    for (let i = 1; i < k; i++) if (heights[i] < heights[min]) min = i;
    cols[min].push(a);
    heights[min] += est;
  }
  return cols;
}

export default function ResultGrid({
  artworks,
  errors,
  note,
  onOpen,
}: {
  artworks: Artwork[];
  errors: SourceError[];
  note?: string;
  onOpen: (a: Artwork) => void;
}) {
  const k = useColumnCount();
  const columns = useMemo(() => distribute(artworks, k), [artworks, k]);

  return (
    <section>
      {note && (
        <p className="mb-6 border-l-2 border-accent pl-4 text-[15px]">{note}</p>
      )}
      {errors.length > 0 && (
        <p className="caption mb-4">
          {errors
            .map((e) => `${sourceLabel(e.source)} unavailable`)
            .join(" · ")}
        </p>
      )}
      {artworks.length === 0 ? (
        <p className="caption py-16 text-center">No results.</p>
      ) : (
        <div className="flex gap-6">
          {columns.map((col, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col">
              {col.map((a) => (
                <ArtworkCard key={a.id} artwork={a} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
