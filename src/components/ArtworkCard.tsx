"use client";

import type { Artwork } from "@/lib/types";
import { useCalmScore } from "@/lib/calm-client";
import SourceBadge from "./SourceBadge";

export default function ArtworkCard({
  artwork,
  onOpen,
}: {
  artwork: Artwork;
  onOpen: (a: Artwork) => void;
}) {
  const calm = useCalmScore(artwork);
  return (
    <figure className="group mb-8 break-inside-avoid">
      <button
        className="block w-full cursor-pointer text-left"
        onClick={() => onOpen(artwork)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={artwork.imageThumb}
          alt={artwork.title}
          loading="lazy"
          className="w-full border border-ink transition-opacity duration-120 group-hover:opacity-90"
        />
      </button>
      <figcaption className="mt-2 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] leading-tight font-medium">
            {artwork.title}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {artwork.color && (
              <span
                aria-hidden
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
          <span className="caption min-w-[4.5em] shrink-0 text-right font-mono">
            {calm ? `calm ${calm.score}` : ""}
          </span>
        </div>
      </figcaption>
    </figure>
  );
}
