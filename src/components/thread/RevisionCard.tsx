"use client";

import type { RevisionData } from "@/lib/thread/types";

/**
 * A turn that changed the exhibit on the wall instead of hanging a new one:
 * which exhibit, and what Curio now says, each comment beside the work it's
 * on (a frame opens the work). The wall already shows the edit; this is the
 * thread's record of it.
 */
export default function RevisionCard({
  revision,
  onWall,
  onShow,
  onOpen,
}: {
  revision: RevisionData;
  onWall: boolean;
  onShow: () => void;
  /** open a work (by id) in the detail view */
  onOpen: (id: string) => void;
}) {
  const set = revision.works.filter((w) => revision.comments[w.id]);
  const removed = Object.values(revision.comments).filter((c) => !c).length;

  return (
    <section
      className="animate-rise flex flex-col gap-3 border-t border-b border-ink py-3"
      aria-label={`Revised: ${revision.title}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="caption">{revision.retitled ? "Retitled" : "Revised"}</p>
          <h3 className="balance text-[15px] leading-snug font-semibold">{revision.title}</h3>
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

      {revision.note && (
        <p className="pretty border-l-2 border-accent pl-2.5 text-[13px] leading-relaxed">{revision.note}</p>
      )}

      {set.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {set.map((w, i) => (
            <li
              key={w.id}
              className="animate-fade flex items-start gap-2.5"
              style={{ ["--stagger" as string]: `${i * 40}ms` }}
            >
              <button
                type="button"
                onClick={() => onOpen(w.id)}
                title={`${w.title}, ${w.artist}`}
                aria-label={`Open ${w.title}`}
                className="press-none group/thumb relative block h-12 w-12 shrink-0 overflow-hidden bg-wash"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 border-2 border-ink opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100"
                />
              </button>
              <div className="min-w-0">
                <p className="caption truncate">{w.title}</p>
                <p className="pretty text-[13px] leading-relaxed">{revision.comments[w.id]}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {removed > 0 && (
        <p className="caption">
          Removed {removed} {removed === 1 ? "comment" : "comments"}
        </p>
      )}
    </section>
  );
}
