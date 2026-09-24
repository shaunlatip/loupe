import type { Artwork } from "@/lib/types";
import { hslToRgb, rgbToOklab, type HSL } from "./color";

/**
 * A surface tint taken from the art itself: the hue of a work's dominant
 * colour at paper lightness and a whisper of chroma, for the two places a
 * single piece gets a surround (the detail view's wall, a card's frame
 * before its image lands). Not the wall label: a tinted band there read as
 * a separate fill competing with the works.
 *
 * The limits keep it a tint, not a colour: lightness pinned at 0.95–0.96 in
 * OKLCH (where ink body text stays above 15:1 and #6b6b6b secondary text
 * above 4.5:1) and chroma capped at 0.018. The cap is low on purpose: a
 * museum's "dominant colour" is often a salient accent (AIC gives a Homer
 * seascape the green of one wave's highlight), so the tint should only
 * lean, never announce. Several colours average in OKLab (a, b), so ones
 * that disagree cancel toward grey. Near-grey results return undefined so
 * the surface keeps its plain wash.
 */

const MAX_CHROMA = 0.018;
/** how much of the art's own chroma carries into the tint */
const GAIN = 0.3;
/** below this the tint is indistinguishable from grey: don't bother */
const MIN_CHROMA = 0.006;

function oklabAB(c: HSL): [number, number] {
  const [, a, b] = rgbToOklab(...hslToRgb(c.h, c.s, c.l));
  return [a, b];
}

export function tintOf(colors: (HSL | undefined)[], lightness = 0.95): string | undefined {
  const pts = colors.filter((c): c is HSL => !!c).map(oklabAB);
  if (pts.length === 0) return undefined;
  const a = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const b = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const chroma = Math.min(MAX_CHROMA, Math.hypot(a, b) * GAIN);
  if (chroma < MIN_CHROMA) return undefined;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${lightness} ${chroma.toFixed(4)} ${hue.toFixed(1)})`;
}

/** One work's tint. */
export function artworkTint(artwork: Pick<Artwork, "color">, lightness?: number): string | undefined {
  return tintOf([artwork.color], lightness);
}
