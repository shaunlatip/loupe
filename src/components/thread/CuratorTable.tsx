"use client";

import type { StepData } from "@/lib/thread/types";
import { Spinner } from "./Glyph";
import { Elapsed } from "./Live";
import { isWorking } from "./status";
import { useThread } from "./ThreadProvider";

/**
 * "On Curio's table": while a turn runs and the thread isn't showing, the
 * works Curio is looking at sit in a band above the wall, larger than in the
 * thread, filling in as each image lands. It folds away when the exhibit
 * goes up. With the thread docked open the same strip is already in view
 * there, so the band stays away, unless the wall is empty, where it takes
 * the place of a skeleton grid.
 */
export default function CuratorTable({ emptyWall = false }: { emptyWall?: boolean }) {
  const { messages, curator, curatorText: text, curatorGlyph, open, mode } = useThread();
  const threadShowing = open && mode === "docked";
  if (!isWorking(curator) || (threadShowing && !emptyWall)) return null;

  const last = messages[messages.length - 1];
  let look: StepData | undefined;
  if (last?.role === "assistant") {
    for (let i = last.parts.length - 1; i >= 0; i--) {
      const p = last.parts[i];
      if (p.type === "data-step" && p.data.kind === "look") {
        look = p.data;
        break;
      }
    }
  }

  return (
    <section
      aria-label="What Curio is looking at"
      className="animate-rise mb-8 flex flex-col gap-3 border-b border-ink pb-5"
    >
      <div className="flex items-center gap-2 text-[12px] leading-[18px]">
        <span aria-hidden className="flex w-3.5 justify-center text-accent">
          <Spinner phase={curatorGlyph} size={12} />
        </span>
        <span className="caption text-ink">On Curio&rsquo;s table</span>
        <span key={text} className="animate-fade text-ink/70">
          · {text}
        </span>
        <Elapsed since={curator.turnStartedAt} className="ml-auto text-muted-foreground" />
      </div>
      {look?.items && look.items.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          {look.items.map((it, i) => (
            <span
              key={it.id}
              title={`${it.title}, ${it.artist}`}
              className={`animate-fade relative block h-[120px] w-[120px] shrink-0 overflow-hidden ${
                it.state === "loading" ? "skeleton" : it.state === "failed" ? "hatch" : "bg-wash"
              }`}
              style={{ ["--stagger" as string]: `${i * 50}ms` }}
            >
              {it.state === "seen" && it.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb} alt="" referrerPolicy="no-referrer" className="animate-fade h-full w-full object-cover" />
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="caption">Searching the collections. The works Curio looks at will appear here.</p>
      )}
    </section>
  );
}
