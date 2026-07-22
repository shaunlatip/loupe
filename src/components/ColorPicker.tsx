"use client";

import { useRef, useState } from "react";
import { type HSL, hslCss, hslToHsv, hsvToHsl } from "@/lib/color";

// A hue spectrum for the quick-pick row — 12 even steps at a mid
// saturation/lightness, the fast way to say "rank these toward blue / ochre /
// green" without dialing the square.
const SWATCH_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const SWATCHES: HSL[] = SWATCH_HUES.map((h) => ({ h, s: 62, l: 50 }));

const HUE_BAR =
  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)";

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/**
 * Amplo's interaction (saturation/value square + hue bar + swatch row) in
 * Loupe's flat register: zero radius, 1px ink borders, no shadows, one accent.
 * Emits HSL (the shape Artwork.color is stored in) on every change; drives the
 * search-by-color similarity ranking. Not a full sRGB/P3 picker — it only
 * needs to name a target hue to rank toward.
 */
export default function ColorPicker({
  value,
  onChange,
  onClear,
}: {
  value?: HSL;
  onChange: (c: HSL) => void;
  onClear: () => void;
}) {
  const seed = value ? hslToHsv(value.h, value.s, value.l) : { h: 210, s: 0.6, v: 0.9 };
  const [hue, setHue] = useState(seed.h);
  const [sat, setSat] = useState(seed.s);
  const [val, setVal] = useState(seed.v);

  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const current = hsvToHsl(hue, sat, val);

  const emit = (h: number, s: number, v: number) => onChange(hsvToHsl(h, s, v));

  const onSquare = (e: React.PointerEvent) => {
    const r = squareRef.current!.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    setSat(x);
    setVal(1 - y);
    emit(hue, x, 1 - y);
  };

  const onHue = (e: React.PointerEvent) => {
    const r = hueRef.current!.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const h = x * 360;
    setHue(h);
    emit(h, sat, val);
  };

  const pickSwatch = (c: HSL) => {
    const hsv = hslToHsv(c.h, c.s, c.l);
    setHue(hsv.h);
    setSat(hsv.s);
    setVal(hsv.v);
    onChange(c);
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {/* saturation × value square */}
      <div
        ref={squareRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSquare(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && onSquare(e)}
        className="relative h-36 w-full cursor-crosshair touch-none border border-ink"
        style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "linear-gradient(to right, #fff, rgba(255,255,255,0))" }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "linear-gradient(to top, #000, rgba(0,0,0,0))" }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute block h-3 w-3 -translate-x-1/2 -translate-y-1/2 border border-paper"
          style={{
            left: `${sat * 100}%`,
            top: `${(1 - val) * 100}%`,
            outline: "1px solid #0a0a0a",
          }}
        />
      </div>

      {/* hue bar */}
      <div
        ref={hueRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onHue(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && onHue(e)}
        className="relative h-3 w-full cursor-ew-resize touch-none border border-ink"
        style={{ backgroundImage: HUE_BAR }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 block h-4 w-2 -translate-x-1/2 -translate-y-1/2 border border-paper"
          style={{ left: `${(hue / 360) * 100}%`, outline: "1px solid #0a0a0a" }}
        />
      </div>

      {/* readout */}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-6 w-6 shrink-0 border border-ink"
          style={{ backgroundColor: hslCss(current) }}
        />
        <span className="caption font-mono">{hslCss(current)}</span>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="invert-hover ml-auto border border-ink px-2 py-0.5 text-[11px]"
          >
            Clear
          </button>
        )}
      </div>

      {/* quick-pick spectrum */}
      <div className="grid grid-cols-6 gap-1">
        {SWATCHES.map((c) => (
          <button
            key={c.h}
            type="button"
            aria-label={`Rank toward hue ${c.h}`}
            onClick={() => pickSwatch(c)}
            className="h-5 w-full border border-ink transition-transform duration-120 hover:scale-110"
            style={{ backgroundColor: hslCss(c) }}
          />
        ))}
      </div>
    </div>
  );
}
