"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rect = calm?.rect;
  const hasSafeZone = !!rect && rect.w > 0 && rect.h > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-wash p-6">
          {/* inline-block shrink-wraps to the image's own rendered box (no
              separate letterboxed frame), so percentage-positioned children
              land exactly on the displayed pixels regardless of viewport. */}
          <div className="relative inline-block max-h-full max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artwork.imageHires}
              alt={artwork.title}
              className="block max-h-full max-w-full border border-ink object-contain"
            />
            {hasSafeZone && (
              <div
                className="pointer-events-none absolute border border-accent"
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
