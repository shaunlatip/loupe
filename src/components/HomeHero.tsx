"use client";

import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/presets";
import { EXAMPLES } from "@/lib/examples";
import type { SourceId } from "@/lib/types";
import Composer from "./thread/Composer";
import { useThread } from "./thread/ThreadProvider";
import { sourceLabel } from "./SourceBadge";

export interface ExamplePreview {
  slug: string;
  thumbs: string[];
}

/**
 * The empty wall. One headline, one input, a handful of places to start, and
 * the collections it all comes from. Laid on the page's 12-column grid:
 * content in columns 1–9, the sources rail in 10–12 behind a 1px rule, so the
 * wordmark, headline, input, first example and "Or browse" share one left
 * edge. Blue appears once, on the input's Ask.
 */
export default function HomeHero({
  sources,
  previews,
  onCategory,
}: {
  sources: SourceId[];
  previews: Record<string, string[]>;
  onCategory: (id: string) => void;
}) {
  const { runExample } = useThread();
  // Focus the input on arrival, but not on touch screens (it would throw up
  // the keyboard over the page before anyone has read it).
  const [autoFocus, setAutoFocus] = useState(false);
  useEffect(() => {
    setAutoFocus(window.matchMedia("(pointer: fine)").matches);
  }, []);
  const browse = (["Movements", "Subjects"] as const).map((group) => ({
    group,
    items: CATEGORIES.filter((c) => c.group === group),
  }));

  return (
    <div className="animate-fade grid grid-cols-12 gap-x-6 gap-y-12 pt-12 pb-10 max-lg:pt-8">
      <div className="col-span-12 flex min-w-0 flex-col gap-10 lg:col-span-9">
        <div className="flex flex-col gap-4">
          <h2 className="pretty max-w-[24ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.015em] max-md:text-[26px]">
            Public-domain paintings from five museums&rsquo; open collections.
          </h2>
          <p className="pretty max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
            Ask for an artist, a mood, or something stranger. Every result is CC0 or public domain and
            downloads at full resolution with attribution.
          </p>
        </div>

        <Composer variant="hero" placeholder="Hokusai, fog over water, cats with opinions…" autoFocus={autoFocus} />

        <section className="flex flex-col gap-3" aria-label="Try one of these">
          <h3 className="caption">Try</h3>
          <div className="grid grid-cols-3 gap-3 max-md:-mx-6 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:overflow-x-auto max-md:px-6 max-md:pb-1">
            {EXAMPLES.map((ex, i) => {
              const thumbs = previews[ex.slug] ?? [];
              return (
                <button
                  key={ex.slug}
                  type="button"
                  onClick={() => runExample(ex.slug)}
                  className="group/ex animate-rise flex flex-col border border-ink bg-paper text-left transition-colors duration-150 hover:bg-ink hover:text-paper max-md:w-[240px] max-md:shrink-0 max-md:snap-start"
                  style={{ ["--stagger" as string]: `${80 + i * 40}ms` }}
                >
                  {thumbs.length > 0 ? (
                    <span className="grid grid-cols-3 gap-px border-b border-ink bg-ink" aria-hidden>
                      {thumbs.slice(0, 3).map((src) => (
                        <span key={src} className="block aspect-square overflow-hidden bg-wash">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="flex flex-1 flex-col gap-1 px-3 py-2.5">
                    <span className="text-[14px] leading-snug font-medium">{ex.label}</span>
                    {thumbs.length === 0 && (
                      <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground group-hover/ex:text-paper/70">
                        {ex.prompt}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-label="Or browse">
          <h3 className="caption">Or browse</h3>
          <dl className="flex flex-col gap-2">
            {browse.map(({ group, items }) => (
              <div key={group} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 max-md:flex-col max-md:gap-2">
                <dt className="caption w-20 shrink-0">{group}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onCategory(c.id)}
                      className="bg-wash px-2.5 py-1 text-[12px] leading-[18px] hover:bg-wash-strong"
                    >
                      {c.label}
                    </button>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <aside className="col-span-12 flex flex-col gap-3 border-t border-ink pt-4 lg:col-span-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <h3 className="caption">Sources</h3>
        <ul className="flex flex-col gap-1 text-[13px] leading-snug max-lg:flex-row max-lg:flex-wrap max-lg:gap-x-3">
          {sources.map((s) => (
            <li key={s}>{sourceLabel(s)}</li>
          ))}
        </ul>
        <p className="caption pretty leading-relaxed">
          Every work is CC0 or public domain, with attribution kept in every download.
        </p>
      </aside>
    </div>
  );
}
