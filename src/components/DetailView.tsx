"use client";

import { useEffect, useState } from "react";
import type { Artwork } from "@/lib/types";
import { useCalmScore } from "@/lib/calm-client";
import { sourceLabel } from "./SourceBadge";

export default function DetailView({
  artwork,
  onClose,
  actions,
}: {
  artwork: Artwork;
  onClose: () => void;
  /** slot for save/export affordances added in later slices */
  actions?: React.ReactNode;
}) {
  const calm = useCalmScore(artwork);
  // Off by default — the overlay is a planning aid, not something to greet
  // every artwork with. Opt in from the panel toggle below.
  const [showSafeZone, setShowSafeZone] = useState(false);

  // Blur-up gate: the hi-res stays hidden until it has *fully* decoded, so it
  // never paints in top-to-bottom. Reset whenever the shown work changes so
  // switching artworks re-runs soft→sharp instead of flashing a stale image.
  const [hiresLoaded, setHiresLoaded] = useState(false);
  useEffect(() => setHiresLoaded(false), [artwork.imageHires]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rect = calm?.rect;
  const hasSafeZone = !!rect && rect.w > 0 && rect.h > 0;

  // Known dims (AIC/CMA, the majority) let us reserve the exact picture box
  // ahead of load; the thumb then fills it at full size instead of the frame
  // sitting empty. Unknown dims (Met minority) fall back to the hi-res sizing
  // the box on decode — the same split the grid card makes.
  const { width, height } = artwork.dims ?? {};
  const ratio = width && height ? width / height : undefined;

  return (
    <div className="animate-modal-in fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-ink px-6 py-3">
        <span className="caption">{sourceLabel(artwork.source)}</span>
        <button
          onClick={onClose}
          className="invert-hover border border-ink px-4 py-1 text-[13px] font-semibold"
        >
          Close
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-wash p-6 [container-type:size]">
          {/* The frame shrink-wraps to the picture's own rendered box (no
              separate letterbox), so percentage-positioned children land on
              the displayed pixels. When dims are known we size that box with
              container-query units — min(fit-by-width, fit-by-height) — which
              reserves the exact contain rect before the hi-res loads; the
              thumb underlay then fills it. Without dims the hi-res sizes the
              box on decode (in-flow), same as before. Border lives on the
              frame so it hugs the picture in both paths. */}
          <div
            className="relative inline-block max-h-full max-w-full border border-ink"
            style={
              ratio
                ? {
                    width: `min(100cqw, 100cqh * ${ratio})`,
                    height: `min(100cqh, 100cqw / ${ratio})`,
                  }
                : undefined
            }
          >
            {ratio && (
              /* LQIP: the grid already decoded imageThumb, so it paints
                 instantly; blurred so the upscale reads as intentional. The
                 overflow-hidden layer clips the blur to the frame so it never
                 haloes past the ink border (no soft glow in a flat register). */
              <div aria-hidden className="absolute inset-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artwork.imageThumb}
                  alt=""
                  className={`h-full w-full object-contain blur-lg transition-opacity duration-150 ${
                    hiresLoaded ? "opacity-0" : "opacity-100"
                  }`}
                />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artwork.imageHires}
              alt={artwork.title}
              decoding="async"
              ref={(el) => {
                if (el?.complete) setHiresLoaded(true);
              }}
              onLoad={() => setHiresLoaded(true)}
              onError={() => setHiresLoaded(true)}
              className={
                ratio
                  ? `absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ${
                      hiresLoaded ? "opacity-100" : "opacity-0"
                    }`
                  : "block max-h-full max-w-full object-contain"
              }
            />
            {hasSafeZone && showSafeZone && (
              <div
                className="animate-fade pointer-events-none absolute border border-accent"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              >
                <span className="caption absolute left-0 top-0 -translate-y-full bg-paper px-1 text-accent">
                  UI-safe zone
                </span>
              </div>
            )}
          </div>
        </div>
        <aside className="w-full shrink-0 overflow-y-auto border-t border-ink p-6 md:w-[360px] md:border-t-0 md:border-l">
          <h2 className="text-[24px] leading-tight font-semibold">
            {artwork.title}
          </h2>
          <p className="mt-1 text-[15px]">{artwork.artist}</p>
          <p className="caption mt-1">{artwork.date}</p>

          {artwork.movements && artwork.movements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {artwork.movements.map((m) => (
                <span
                  key={m}
                  className="caption border border-ink px-2 py-1 text-accent"
                >
                  {m}
                </span>
              ))}
            </div>
          )}

          <dl className="mt-8 flex flex-col gap-3 border-t border-ink pt-4">
            {artwork.medium && (
              <div>
                <dt className="caption">Medium</dt>
                <dd className="text-[13px]">{artwork.medium}</dd>
              </div>
            )}
            {artwork.accession && (
              <div>
                <dt className="caption">Accession</dt>
                <dd className="font-mono text-[13px]">{artwork.accession}</dd>
              </div>
            )}
            <div>
              <dt className="caption">License</dt>
              <dd className="font-mono text-[13px]">{artwork.license}</dd>
            </div>
            {artwork.color && (
              <div>
                <dt className="caption">Dominant color</dt>
                <dd className="flex items-center gap-2 text-[13px]">
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-ink"
                    style={{
                      backgroundColor: `hsl(${artwork.color.h} ${artwork.color.s}% ${artwork.color.l}%)`,
                    }}
                  />
                  <span className="font-mono">
                    hsl({artwork.color.h}, {artwork.color.s}%, {artwork.color.l}%)
                  </span>
                </dd>
              </div>
            )}
            <div>
              <dt className="caption">Source</dt>
              <dd className="text-[13px]">
                <a
                  href={artwork.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-accent"
                >
                  View at {sourceLabel(artwork.source)} ↗
                </a>
              </dd>
            </div>
          </dl>

          {hasSafeZone && (
            <label className="mt-6 flex cursor-pointer select-none items-center gap-2 border-t border-ink pt-4 text-[13px]">
              <input
                type="checkbox"
                checked={showSafeZone}
                onChange={() => setShowSafeZone((v) => !v)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={`block h-3 w-3 border border-ink ${
                  showSafeZone ? "bg-accent" : "bg-paper"
                }`}
              />
              Show UI-safe zone
              <span className="caption ml-auto">largest quiet area</span>
            </label>
          )}

          {actions && (
            <div className="mt-8 flex flex-col gap-2 border-t border-ink pt-4">
              {actions}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
