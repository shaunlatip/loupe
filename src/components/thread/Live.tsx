"use client";

import { useEffect, useState } from "react";
import { Spinner } from "./Glyph";
import { PHRASE_MS, thinkingPhrases } from "./phrases";
import type { CuratorStatus } from "./status";

/** Re-render every `ms` while `on` (for timers and phrase rotation). */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Elapsed({ since, className = "" }: { since?: number; className?: string }) {
  const now = useNow(since !== undefined);
  if (since === undefined) return null;
  return <span className={`tabular font-mono ${className}`}>{fmtElapsed(now - since)}</span>;
}

/**
 * The one live line shown when Curio is between visible steps: a phrase
 * chosen by what just happened, crossfading every few seconds. Rendered only
 * when no step is running and no text is streaming, so the thread never has
 * two animated lines at once.
 */
export function ThinkingLine({ status }: { status: CuratorStatus }) {
  const [enteredAt] = useState(() => Date.now());
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const now = useNow(!reduce, PHRASE_MS);
  const phrases = thinkingPhrases(status, now - enteredAt);
  const index = reduce ? 0 : Math.floor((now - enteredAt) / PHRASE_MS) % phrases.length;
  const phrase = phrases[index] ?? phrases[0];

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span aria-hidden className="flex h-[18px] w-3 shrink-0 items-center justify-center text-accent">
        <Spinner phase="thinking" size={11} />
      </span>
      <span key={phrase} className="animate-fade text-sweep text-[12px] leading-[18px]">
        {phrase}
      </span>
    </div>
  );
}
