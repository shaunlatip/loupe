/**
 * Color math for the search-by-color filter. Artwork.color is stored as HSL
 * (AIC's dominant-color analysis). The picker works in HSV (the familiar
 * saturation/value square + hue bar, à la Amplo), so we convert between the
 * two; similarity ranking converts HSL → OKLab and takes Euclidean distance,
 * which tracks perceived difference far better than raw HSL deltas (equal HSL
 * steps are wildly unequal to the eye, especially around hue and lightness).
 */

export interface HSL {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** HSL → sRGB, each channel 0..1. Standard piecewise formula. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** sRGB (0..1) → OKLab. Björn Ottosson's matrices. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** Perceptual distance between two HSL colors (OKLab Euclidean; ~0..1+). */
export function colorDistance(a: HSL, b: HSL): number {
  const [al, aa, ab] = rgbToOklab(...hslToRgb(a.h, a.s, a.l));
  const [bl, ba, bb] = rgbToOklab(...hslToRgb(b.h, b.s, b.l));
  return Math.hypot(al - bl, aa - ba, ab - bb);
}

/** HSV (s,v in 0..1) → HSL (s,l in 0..100). */
export function hsvToHsl(h: number, s: number, v: number): HSL {
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s: sl * 100, l: l * 100 };
}

/** HSL (s,l in 0..100) → HSV (s,v in 0..1). */
export function hslToHsv(h: number, s: number, l: number): HSV {
  s /= 100;
  l /= 100;
  const v = l + s * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return { h, s: clamp01(sv), v: clamp01(v) };
}

/** CSS string for an HSL triple. */
export function hslCss({ h, s, l }: HSL): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

/**
 * "#rrggbb" (or "rrggbb") → HSL, matching AIC's stored triple so hex-palette
 * sources (SMK `colors[]`, Harvard `colors[].color`) join AIC in the color
 * sort. Returns undefined for anything that isn't a 6-digit hex. Standard
 * sRGB → HSL formula; h 0..360, s/l 0..100.
 */
export function hexToHsl(hex: string): HSL | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}
