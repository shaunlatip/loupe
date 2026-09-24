"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { StepData, StepItem } from "@/lib/thread/types";
import Icon from "../Icon";
import { StepGlyph } from "./Glyph";
import { stepLabel } from "./status";

/** A quiet fact beside a step label. */
function Chip({ children, tone = "default", title }: { children: ReactNode; tone?: "default" | "error"; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-1.5 text-[11px] leading-[18px] tracking-[0.03em] ${
        tone === "error"
          ? "border border-destructive/50 text-destructive"
          : "bg-wash text-ink/70"
      }`}
    >
      {children}
    </span>
  );
}

/** The raw material a search brought back: five works, dimmed, because
 *  Curio hasn't looked at them yet. */
function PreviewStrip({ items }: { items: StepItem[] }) {
  if (!items.length) return null;
  return (
    <span className="ml-1 inline-flex gap-[3px] align-middle" aria-hidden>
      {items.map((it) => (
        <span key={it.id} className="block h-5 w-5 overflow-hidden bg-wash" title={`${it.title}, ${it.artist}`}>
          {it.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover opacity-60 grayscale-[40%]" />
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * The works Curio is looking at, one frame each, filling in as each image
 * lands. While it weighs them, a hairline steps across the strip (it says
 * "looking" without claiming which one). Once the exhibit is curated, the
 * works that made it keep full strength and a small accent mark; the rest
 * recede.
 */
function LookStrip({
  items,
  kept,
  scanning,
}: {
  items: StepItem[];
  kept?: Set<string>;
  scanning: boolean;
}) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!scanning) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => setAt((i) => (i + 1) % Math.max(1, items.length)), 400);
    return () => clearInterval(t);
  }, [scanning, items.length]);

  // One row always: a look is at most 8 works (VIEW_LIMIT), so eight columns
  // of up to 40px that shrink with a narrow thread rather than wrap one
  // orphan frame onto a second line.
  return (
    <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: "repeat(8, minmax(0, 40px))" }}>
      {items.map((it, i) => {
        const made = kept?.has(it.id);
        const passed = kept && !made;
        return (
          <span
            key={it.id}
            title={
              it.state === "failed"
                ? `${it.title}: couldn't load this image`
                : `${it.title}, ${it.artist}${made ? " · made the exhibit" : passed ? " · passed over" : ""}`
            }
            className={`relative block aspect-square w-full overflow-hidden transition-opacity duration-300 ${
              it.state === "loading" ? "skeleton" : it.state === "failed" ? "hatch" : "bg-wash"
            } ${passed ? "opacity-40" : "opacity-100"}`}
          >
            {it.state === "seen" && it.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={it.thumb}
                alt=""
                referrerPolicy="no-referrer"
                className="animate-fade h-full w-full object-cover"
              />
            )}
            {made && <span aria-hidden className="absolute bottom-0 left-0 h-1.5 w-1.5 bg-accent" />}
            {scanning && at === i && (
              <span aria-hidden className="pointer-events-none absolute inset-0 border border-accent" />
            )}
          </span>
        );
      })}
    </div>
  );
}

export function StepRow({
  step,
  kept,
  unavailable = step.unavailable,
  scanning = false,
}: {
  step: StepData;
  kept?: Set<string>;
  /** museums to report as not answering here (the turn reports each once) */
  unavailable?: string[];
  scanning?: boolean;
}) {
  const running = step.phase === "running";
  // a step that errored never got to "Searched …": keep the in-progress form
  const label = stepLabel(step, running || step.phase === "error");
  if (step.kind === "exhibit" && step.phase === "done") return null; // the exhibit card stands in

  return (
    <div className="flex items-start gap-2">
      <StepGlyph kind={step.kind} phase={step.phase} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span
            className={`text-[12px] leading-[18px] ${
              running ? "text-sweep" : step.phase === "error" ? "text-destructive" : "text-ink/80"
            }`}
          >
            {label}
          </span>
          {step.kind === "search" && (
            <>
              {step.years && <Chip>{step.years}</Chip>}
              {step.source && <Chip>{step.source}</Chip>}
              {step.phase === "done" && (
                <Chip>
                  <span className="tabular">
                    {step.count === 0 ? "nothing matched" : `${step.count} ${step.count === 1 ? "work" : "works"}`}
                  </span>
                </Chip>
              )}
              {step.phase === "done" && unavailable && unavailable.length > 0 && (
                <Chip tone="error" title="Didn't answer this search; later searches in this turn may miss it too">
                  {`${unavailable.join(", ")} didn’t answer`}
                </Chip>
              )}
              {step.phase === "done" && step.items && <PreviewStrip items={step.items} />}
            </>
          )}
          {step.phase === "error" && step.error && (
            <Chip tone="error" title={step.error}>
              {step.error === "didn't finish" ? "didn’t finish" : "failed"}
            </Chip>
          )}
        </div>
        {step.kind === "look" && step.items && (
          <LookStrip items={step.items} kept={kept} scanning={scanning} />
        )}
      </div>
    </div>
  );
}

/**
 * A turn's work as one group. Open while it runs (the steps are the live
 * indicator); once done it folds to "Worked for 38s" with the counts, and
 * opens on click. Errors force it open.
 */
export function WorkGroup({
  running,
  seconds,
  counts,
  hasError,
  children,
}: {
  running: boolean;
  seconds?: number;
  counts: { searches: number; lookedAt: number; kept?: number };
  hasError: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (running || hasError);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="press-none group/wg -ml-1 flex items-start gap-1.5 self-start px-1 text-left text-[12px] leading-[18px] text-ink/70 hover:text-ink"
      >
        <span aria-hidden className="flex h-[18px] w-3 shrink-0 items-center justify-center">
          <Icon
            icon={ChevronRight}
            size={12}
            className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        </span>
        {running ? (
          <span>Working</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{seconds ? `Worked for ${seconds}s` : "Worked"}</span>
            {counts.searches > 0 && (
              <Chip>
                {counts.searches} {counts.searches === 1 ? "search" : "searches"}
              </Chip>
            )}
            {counts.lookedAt > 0 && <Chip>{counts.lookedAt} looked at</Chip>}
            {counts.kept !== undefined && counts.kept > 0 && <Chip>{counts.kept} made the exhibit</Chip>}
          </span>
        )}
      </button>
      {expanded && <div className="flex flex-col gap-2 border-l border-ink/15 pl-3">{children}</div>}
    </div>
  );
}
