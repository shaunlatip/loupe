"use client";

import { useEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";
import { useCalmScore } from "@/lib/calm-client";
import SourceBadge from "./SourceBadge";

/** Cards past this reading-order index enter without delay — the stagger is
 *  for the first screenful; everything below the fold is already scrolled to. */
const STAGGER_LIMIT = 16;
const STAGGER_STEP_MS = 28;

export default function ArtworkCard({
  artwork,
  index = 0,
  onOpen,
}: {
  artwork: Artwork;
  /** reading-order position, drives the entrance stagger */
  index?: number;
  onOpen: (a: Artwork) => void;
}) {
  const calm = useCalmScore(artwork);

  // Reserving the image box up front is what stops the masonry from
  // reflowing as thumbnails decode: with aspect-ratio set from the known
  // dims (AIC/CMA carry them), the column height is final before a single
  // pixel loads, so nothing below shifts. The thumb is a scaled copy of the
  // same image, so dims give its exact ratio. Met has no dims — those cards
  // fall back to natural sizing and settle on load (the minority).
  const { width, height } = artwork.dims ?? {};
  const ratio = width && height ? width / height : undefined;

  // With space reserved we can hide the image until it decodes and fade it
  // in — pure opacity, never layout. Unknown-ratio cards skip the hide so
  // they don't collapse-then-pop. While hidden, the reserved box carries the
  // wash so the wall reads as frames-awaiting-pictures, not holes.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const fadeReady = ratio !== undefined;

  // Warm the hi-res on hover intent so DetailView opens sharp (or nearly)
  // instead of dwelling on the blur-up: by click the full image is usually
  // decoded and cached, so its <img> mounts `complete` and skips the fade.
  // Guarded to fire once, and only after a brief linger, so grazing the grid
  // to reach one card doesn't fetch dozens of full-size images.
  const warmed = useRef(false);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AIC's IIIF server 403s any cross-origin Referer (it only serves when none
  // is sent), so every museum image request goes out referrer-less — the
  // grid <img> below, this warm-up, and DetailView alike.
  const warmHires = () => {
    if (warmed.current) return;
    warmed.current = true;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = artwork.imageHires;
  };
  const warmSoon = () => {
    if (warmed.current || warmTimer.current) return;
    warmTimer.current = setTimeout(warmHires, 120);
  };
  const cancelWarm = () => {
    if (warmTimer.current) {
      clearTimeout(warmTimer.current);
      warmTimer.current = null;
    }
  };
  useEffect(() => cancelWarm, []);

  const stagger = index < STAGGER_LIMIT ? index * STAGGER_STEP_MS : 0;

  return (
    <figure
      className="group animate-fade mb-8"
      style={{ ["--stagger" as string]: `${stagger}ms` }}
    >
      <button
        className="press-none block w-full cursor-pointer text-left"
        onClick={() => onOpen(artwork)}
        onPointerEnter={warmSoon}
        onPointerLeave={cancelWarm}
        onPointerDown={warmHires}
        onFocus={warmHires}
        aria-label={`${artwork.title}, ${artwork.artist}`}
      >
        <span
          className={`relative block w-full border border-ink ${
            fadeReady && !loaded ? "bg-wash" : ""
          }`}
          style={ratio ? { aspectRatio: String(ratio) } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artwork.imageThumb}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0) setLoaded(true);
            }}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(true);
              setFailed(true);
            }}
            className={`block w-full transition-opacity duration-300 ${
              ratio ? "h-full object-cover" : ""
            } ${fadeReady && !loaded ? "opacity-0" : "opacity-100"} ${
              failed ? "hidden" : ""
            }`}
          />
          {failed && (
            <span className="caption absolute inset-0 flex items-center justify-center bg-wash">
              image unavailable
            </span>
          )}
          {/* Hover: a second ink line inside the frame — the museum "mat".
              Pure opacity, no layout, no shadow. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 border-[3px] border-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          />
        </span>
      </button>
      <figcaption className="mt-2 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="pretty text-[14px] leading-tight font-medium underline-offset-2 group-hover:underline">
            {artwork.title}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {artwork.color && (
              <span
                aria-hidden
                title="Dominant color"
                className="h-3 w-3 border border-ink"
                style={{
                  backgroundColor: `hsl(${artwork.color.h} ${artwork.color.s}% ${artwork.color.l}%)`,
                }}
              />
            )}
            <SourceBadge source={artwork.source} />
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="caption">
            {artwork.artist}
            {artwork.date ? ` · ${artwork.date}` : ""}
          </span>
          {/* fixed-width slot reserved up front — no shift when the score lands */}
          <span
            className="caption tabular min-w-[4.5em] shrink-0 text-right font-mono"
            title={calm ? "Calm score: share of the image that is quiet enough to sit UI on" : undefined}
          >
            {calm ? `calm ${calm.score}` : ""}
          </span>
        </div>
      </figcaption>
    </figure>
  );
}
