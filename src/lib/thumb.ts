import type { Artwork } from "@/lib/types";

/**
 * A small version of a work's thumbnail, for the thread's step strips,
 * attachment chips and example cards (20–120px on screen). AIC and SMK serve
 * IIIF, so the size segment can be rewritten; the other museums have no sizing
 * hook and their ~800px thumbnail is used as-is (the browser caches it for the
 * wall anyway).
 */
export function smallThumb(artwork: Pick<Artwork, "source" | "imageThumb">, box = 240): string {
  if (artwork.source === "aic" || artwork.source === "smk") {
    return artwork.imageThumb.replace(/\/full\/[^/]+\//, `/full/!${box},${box}/`);
  }
  return artwork.imageThumb;
}
