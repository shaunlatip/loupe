import type { Artwork } from "@/lib/types";
import { peekCalm } from "@/lib/calm-client";
import { type HSL, colorDistance } from "@/lib/color";

/** "relevance" is the unmodified fetch order. "similar" ranks by distance to a
 *  picked colour; it's driven by the Color picker, not a Sort row. */
export type SortMode = "relevance" | "lightest" | "darkest" | "hue" | "calmest" | "similar";

/**
 * Sort runs after the movement filter. Works lacking `color` (Met/CMA, or AIC
 * records AIC didn't analyse) sort to the end rather than dropping out —
 * Array#sort is stable, so within each group original order is preserved.
 *
 * "calmest" follows the same convention: scores compute lazily (see
 * calm-client.ts), so unscored works sort to the end; each score that
 * resolves re-runs this sort so the grid settles progressively.
 */
export function sortArtworks(list: Artwork[], mode: SortMode, target?: HSL): Artwork[] {
  if (mode === "relevance") return list;
  if (mode === "similar") {
    if (!target) return list;
    const withColor: Artwork[] = [];
    const withoutColor: Artwork[] = [];
    for (const a of list) (a.color ? withColor : withoutColor).push(a);
    withColor.sort((a, b) => colorDistance(a.color!, target) - colorDistance(b.color!, target));
    return [...withColor, ...withoutColor];
  }
  if (mode === "calmest") {
    const scored: Artwork[] = [];
    const unscored: Artwork[] = [];
    for (const a of list) (peekCalm(a.id) ? scored : unscored).push(a);
    scored.sort((a, b) => peekCalm(b.id)!.score - peekCalm(a.id)!.score);
    return [...scored, ...unscored];
  }
  const withColor: Artwork[] = [];
  const withoutColor: Artwork[] = [];
  for (const a of list) (a.color ? withColor : withoutColor).push(a);
  withColor.sort((a, b) => {
    if (mode === "lightest") return b.color!.l - a.color!.l;
    if (mode === "darkest") return a.color!.l - b.color!.l;
    return a.color!.h - b.color!.h;
  });
  return [...withColor, ...withoutColor];
}
