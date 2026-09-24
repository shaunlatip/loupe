"use client";

import { BookOpen, Eye, Frame, PenLine, Search, type LucideIcon } from "lucide-react";
import { Blocks, Flip, Gather, Morph } from "loading-dev";
import type { StepKind } from "@/lib/thread/types";
import Icon from "../Icon";
import type { CuratorPhase } from "./status";

/**
 * One vocabulary of motion for Curio's work, used everywhere it shows:
 *   searching  Flip    a square flipping over: going through the drawers
 *   looking    Morph   a square rounding to a circle: the loupe focusing
 *   reading    Blocks  rows lighting in turn: lines of a label, read down
 *   choosing   Gather  four blocks pulling together: a set coming together,
 *   curating           from weighing what it saw through to hanging it
 *   thinking   Flip, slower
 * At rest each kind has a static glyph instead.
 */

const GLYPH: Record<StepKind, LucideIcon> = {
  search: Search,
  look: Eye,
  read: BookOpen,
  exhibit: Frame,
  revise: PenLine,
};

export function Spinner({
  phase,
  size = 12,
  className,
}: {
  phase: CuratorPhase | StepKind;
  size?: number;
  className?: string;
}) {
  if (phase === "look" || phase === "looking") return <Morph size={size} className={className} />;
  if (phase === "read" || phase === "reading") return <Blocks sweep="rows" size={size} className={className} />;
  if (phase === "exhibit" || phase === "revise" || phase === "curating" || phase === "choosing")
    return <Gather size={size} className={className} />;
  if (phase === "thinking") return <Flip size={size} duration={1800} className={className} />;
  return <Flip size={size} className={className} />;
}

/** A step's glyph, sized to sit optically centred on a 12/18 caption line. */
export function StepGlyph({
  kind,
  phase,
}: {
  kind: StepKind;
  phase: "running" | "done" | "error";
}) {
  return (
    <span
      aria-hidden
      className={`flex h-[18px] w-3 shrink-0 items-center justify-center ${
        phase === "error" ? "text-destructive" : phase === "running" ? "text-accent" : "text-ink/45"
      }`}
    >
      {phase === "running" ? (
        <Spinner phase={kind} size={11} />
      ) : (
        <Icon icon={GLYPH[kind]} size={12} />
      )}
    </span>
  );
}
