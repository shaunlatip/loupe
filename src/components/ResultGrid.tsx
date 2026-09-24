"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Artwork, SourceError } from "@/lib/types";
import ArtworkCard from "./ArtworkCard";
import { sourceLabel } from "./SourceBadge";

/**
 * Column count from the grid's own width, not the window's: the docked thread
 * takes a resizable slice of the page, so the same window can hold a wide or a
 * narrow wall. ResizeObserver on the section; the thresholds keep columns
 * between ~240px and ~320px wide.
 */
function useColumnCount(ref: React.RefObject<HTMLElement | null>): number {
  const [k, setK] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => setK(w >= 1100 ? 4 : w >= 680 ? 3 : 2);
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return k;
}

/** A quiet fact in the wall label: wash fill, caption size, no rule. */
export function MetaChip({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "error";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-2 py-0.5 text-[11px] leading-[1.5] tracking-[0.04em] ${
        tone === "error"
          ? "border border-destructive/60 text-destructive"
          : "bg-wash text-ink/80"
      }`}
    >
      {children}
    </span>
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
 * no-reflow behavior holds. Each entry keeps its reading-order index so the
 * entrance stagger cascades across rows, not down columns.
 */
function distribute(artworks: Artwork[], k: number): { a: Artwork; i: number }[][] {
  const cols: { a: Artwork; i: number }[][] = Array.from({ length: k }, () => []);
  const heights = new Array(k).fill(0);
  artworks.forEach((a, i) => {
    const { width, height } = a.dims ?? {};
    const ratio = width && height ? width / height : 0.8;
    // 300px nominal column width / ratio = image height, + caption + margin.
    const est = 300 / ratio + 54 + 32;
    let min = 0;
    for (let c = 1; c < k; c++) if (heights[c] < heights[min]) min = c;
    cols[min].push({ a, i });
    heights[min] += est;
  });
  return cols;
}

/** Empty frames in the wash while a fanout is in flight — the grid's shape
 *  before its content. Ratios vary so it reads as a wall, not a table. */
const SKELETON_RATIOS = [1.4, 0.8, 1.1, 0.75, 1.3, 0.9, 1.0, 0.7, 1.5, 0.85, 1.2, 0.8];

function SkeletonGrid({ k }: { k: number }) {
  const cols = Array.from({ length: k }, () => [] as number[]);
  SKELETON_RATIOS.forEach((r, i) => cols[i % k].push(r));
  return (
    <div className="flex gap-6" aria-hidden>
      {cols.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col">
          {col.map((ratio, i) => (
            <div
              key={i}
              className="animate-fade mb-8"
              style={{ ["--stagger" as string]: `${(c + i * k) * 40}ms` }}
            >
              <div
                className="skeleton w-full border border-ink/20"
                style={{ aspectRatio: String(ratio) }}
              />
              <div className="mt-2 h-[14px] w-3/4 bg-wash" />
              <div className="mt-2 h-[11px] w-1/2 bg-wash" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ResultGrid({
  artworks,
  errors,
  heading,
  note,
  loading = false,
  emptyHint,
  facts,
  aside,
  labelStyle,
  onOpen,
}: {
  artworks: Artwork[];
  errors: SourceError[];
  /** the query / category / collection name, set as the wall title */
  heading?: string;
  /** curator's note, or any secondary line under the heading */
  note?: string;
  /** a fetch is in flight — an empty grid means "searching", not "no results" */
  loading?: boolean;
  /** rendered inside the no-results state (suggested next moves) */
  emptyHint?: ReactNode;
  /** extra chips after the counts (e.g. an interpreted query's facets) */
  facts?: ReactNode;
  /** right end of the label's fact row (Sort) */
  aside?: ReactNode;
  /** the label band's background (a derived exhibit colour), if any */
  labelStyle?: React.CSSProperties;
  onOpen: (a: Artwork) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const k = useColumnCount(sectionRef);
  const columns = useMemo(() => distribute(artworks, k), [artworks, k]);

  const sourceCount = new Set(artworks.map((a) => a.source)).size;
  const count = artworks.length;

  return (
    <section ref={sectionRef} aria-busy={loading}>
      {/* Wall label — the museum-caption register: what you're looking at,
          then how much of it and from where. */}
      {(heading || note || count > 0 || loading) && (
        <header
          className={`mb-8 flex flex-col gap-3 border-b border-ink pb-4 transition-[background-color] duration-200 ${
            labelStyle ? "-mx-6 px-6 pt-5" : ""
          }`}
          style={labelStyle}
        >
          {heading && (
            <h2 className="balance text-[32px] leading-[1.1] font-semibold tracking-[-0.015em] max-md:text-[24px]">
              {heading}
            </h2>
          )}
          {note && (
            <p className="pretty max-w-[64ch] border-l-2 border-accent pl-3 text-[15px] leading-snug">
              {note}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
              {loading ? (
                <span className="text-sweep text-[12px] tracking-[0.04em]">
                  Searching the collections
                </span>
              ) : (
                <>
                  <MetaChip>
                    <span className="tabular">
                      {count === 0 ? "No works" : `${count} ${count === 1 ? "work" : "works"}`}
                    </span>
                  </MetaChip>
                  {count > 0 && (
                    <MetaChip>
                      <span className="tabular">
                        {sourceCount} {sourceCount === 1 ? "museum" : "museums"}
                      </span>
                    </MetaChip>
                  )}
                  {facts}
                  {errors.length > 0 && (
                    <MetaChip tone="error" title={errors.map((e) => e.message).join("\n")}>
                      {errors.map((e) => sourceLabel(e.source)).join(", ")} didn&rsquo;t answer
                    </MetaChip>
                  )}
                </>
              )}
            </div>
            {aside && count > 0 && <div className="ml-auto shrink-0">{aside}</div>}
          </div>
        </header>
      )}

      {count === 0 ? (
        loading ? (
          <SkeletonGrid k={k} />
        ) : (
          <div className="animate-fade flex flex-col gap-3 py-12">
            <p className="text-[15px]">Nothing came back for this.</p>
            {emptyHint && <div className="caption flex flex-col gap-1.5">{emptyHint}</div>}
          </div>
        )
      ) : (
        // A new query keeps the previous wall in place, dimmed, until the
        // fanout lands — no collapse-to-skeleton, no layout jump.
        <div
          className={`flex gap-6 transition-opacity duration-200 ${
            loading ? "pointer-events-none opacity-40" : "opacity-100"
          }`}
          aria-hidden={loading || undefined}
        >
          {columns.map((col, c) => (
            <div key={c} className="flex min-w-0 flex-1 flex-col">
              {col.map(({ a, i }) => (
                <ArtworkCard key={a.id} artwork={a} index={i} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Memoised: the page re-renders on every streamed curator token; the wall
 *  only needs to when its own inputs change. */
export default memo(ResultGrid);
