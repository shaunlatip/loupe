"use client";

import type { Artwork } from "@/lib/types";
import type { ExhibitData } from "@/lib/thread/types";
import { smallThumb } from "@/lib/thumb";

/**
 * An exhibit in the thread: its title, the works as a strip of frames (each
 * opens the work), Curio's note, and where to go next. The one that's on the
 * wall says so; any earlier one can be put back up.
 */
export default function ExhibitCard({
  exhibit,
  onWall,
  onShow,
  onOpen,
  onFollowUp,
  recorded,
  onRunFresh,
  busy,
}: {
  exhibit: ExhibitData;
  onWall: boolean;
  onShow: () => void;
  onOpen: (a: Artwork) => void;
  onFollowUp: (text: string) => void;
  recorded?: boolean;
  onRunFresh?: () => void;
  busy: boolean;
}) {
  const shown = exhibit.artworks.slice(0, 8);
  const more = exhibit.artworks.length - shown.length;

  return (
    <section className="animate-rise flex flex-col gap-3 border-t border-b border-ink py-3" aria-label={`Exhibit: ${exhibit.title}`}>
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="caption">{exhibit.fallback ? "A first pass" : "Exhibit"}</p>
          <h3 className="balance text-[15px] leading-snug font-semibold">{exhibit.title}</h3>
        </div>
        {onWall ? (
          <span className="caption shrink-0 text-ink">On the wall</span>
        ) : (
          <button
            type="button"
            onClick={onShow}
            className="caption press-none shrink-0 underline underline-offset-2 hover:text-ink"
          >
            Show this exhibit
          </button>
        )}
      </header>

      <div className="flex gap-1">
        {shown.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            title={`${a.title}, ${a.artist}`}
            aria-label={`Open ${a.title}`}
            className="press-none animate-fade group/thumb relative block h-12 min-w-0 flex-1 overflow-hidden bg-wash"
            style={{ ["--stagger" as string]: `${i * 40}ms` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={smallThumb(a)}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 border-2 border-ink opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100"
            />
          </button>
        ))}
        {more > 0 && (
          <span className="caption tabular flex h-12 shrink-0 items-center px-1">+{more}</span>
        )}
      </div>

      {exhibit.note && (
        <p className="pretty border-l-2 border-accent pl-2.5 text-[13px] leading-relaxed">
          {exhibit.note}
        </p>
      )}

      {exhibit.followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {exhibit.followUps.map((f) => (
            <button
              key={f}
              type="button"
              disabled={busy}
              onClick={() => onFollowUp(f)}
              className="bg-wash px-2.5 py-1 text-[12px] leading-[18px] hover:bg-wash-strong disabled:opacity-40"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {recorded && (
        <p className="caption">
          Recorded run
          {onRunFresh && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onRunFresh}
                disabled={busy}
                className="press-none underline underline-offset-2 hover:text-ink disabled:opacity-40"
              >
                Run it fresh
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
