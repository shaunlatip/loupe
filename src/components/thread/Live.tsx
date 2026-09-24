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

/**
 * A status line's text, held for at least `ms` per value. Steps can change
 * every few milliseconds (parallel searches, a replayed run); each change
 * restarts the line's fade, so without a floor it would never finish fading
 * in and the line would read as blank. The latest value always lands.
 */
export function useSteadyText(text: string, ms = 450): string {
  const [shown, setShown] = useState(text);
  const [since, setSince] = useState(0);
  useEffect(() => {
    if (text === shown) return;
    const wait = since + ms - Date.now();
    if (wait <= 0) {
      setShown(text);
      setSince(Date.now());
      return;
    }
    const t = setTimeout(() => {
      setShown(text);
      setSince(Date.now());
    }, wait);
    return () => clearTimeout(t);
  }, [text, shown, since, ms]);
  return shown;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds since `since`. Ticks on the turn's own second boundaries (not
 *  every 1000ms from whenever it mounted), so every timer showing the same
 *  turn (the status line, the header pill, the table band) flips together. */
export function Elapsed({ since, className = "" }: { since?: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      t = setTimeout(tick, 1000 - ((n - since) % 1000) + 5);
    };
    tick();
    return () => clearTimeout(t);
  }, [since]);
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
        <Spinner phase={status.phase === "choosing" ? "choosing" : "thinking"} size={11} />
      </span>
      <span key={phrase} className="animate-fade text-sweep text-[12px] leading-[18px]">
        {phrase}
      </span>
    </div>
  );
}
