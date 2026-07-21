"use client";

import type { Artwork } from "@/lib/types";
import SourceBadge from "./SourceBadge";

export default function ArtworkCard({
  artwork,
  onOpen,
}: {
  artwork: Artwork;
  onOpen: (a: Artwork) => void;
}) {
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
          <SourceBadge source={artwork.source} />
        </div>
        <span className="caption">
          {artwork.artist}
          {artwork.date ? ` · ${artwork.date}` : ""}
        </span>
      </figcaption>
    </figure>
  );
}
