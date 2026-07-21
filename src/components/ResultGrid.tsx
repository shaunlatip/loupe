"use client";

import type { Artwork, SourceError } from "@/lib/types";
import ArtworkCard from "./ArtworkCard";
import { sourceLabel } from "./SourceBadge";

export default function ResultGrid({
  artworks,
  errors,
  note,
  onOpen,
}: {
  artworks: Artwork[];
  errors: SourceError[];
  note?: string;
  onOpen: (a: Artwork) => void;
}) {
  return (
    <section>
      {note && (
        <p className="mb-6 border-l-2 border-accent pl-4 text-[15px]">{note}</p>
      )}
      {errors.length > 0 && (
        <p className="caption mb-4">
          {errors
            .map((e) => `${sourceLabel(e.source)} unavailable`)
            .join(" · ")}
        </p>
      )}
      {artworks.length === 0 ? (
        <p className="caption py-16 text-center">No results.</p>
      ) : (
        <div className="columns-2 gap-6 md:columns-3 xl:columns-4">
          {artworks.map((a) => (
            <ArtworkCard key={a.id} artwork={a} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
