"use client";

import { useEffect, useState } from "react";
import type { Artwork } from "@/lib/types";
import type { CalmResult } from "@/lib/calm";

/**
 * Client-side cache + lazy scheduler for `GET /api/calm`. Scores are never
 * attached to `Artwork` (see the note in calm.ts) — everything here is
 * keyed by artwork id in a module-level Map, so cards mounting/unmounting
 * as results re-sort never lose or recompute a score.
 *
 * Lazy by design: ~100 cards can mount at once (React mounts them
 * immediately even though their <img> uses `loading="lazy"`), and each
 * score costs a network round trip + server-side decode. Firing 100
 * requests in one tick would still be a self-inflicted stampede even
 * though the heavy pixel work happens off the main thread on the server —
 * so requests are queued and drained a few at a time, scheduled via
 * `requestIdleCallback` (falling back to a short `setTimeout` where it's
 * unavailable, e.g. Safari) so scroll/paint always wins.
 */

const cache = new Map<string, CalmResult>();
const inFlight = new Set<string>();
const queue: { id: string; url: string }[] = [];
const queued = new Set<string>();
const subscribers = new Set<() => void>();

const MAX_CONCURRENT = 3;

function notify() {
  for (const cb of subscribers) cb();
}

function idle(cb: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(cb, { timeout: 500 });
  } else {
    setTimeout(cb, 32);
  }
}

function pump() {
  if (inFlight.size >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (!next) return;
  queued.delete(next.id);
  inFlight.add(next.id);
  idle(() => {
    fetch(`/api/calm?id=${encodeURIComponent(next.id)}&url=${encodeURIComponent(next.url)}`)
      .then((res) => (res.ok ? (res.json() as Promise<CalmResult>) : null))
      .then((result) => {
        if (result) cache.set(next.id, result);
      })
      .catch(() => {
        /* leave uncached — score stays "unavailable", not an error state in the UI */
      })
      .finally(() => {
        inFlight.delete(next.id);
        notify();
        pump();
      });
  });
}

function enqueue(id: string, url: string) {
  if (cache.has(id) || inFlight.has(id) || queued.has(id)) return;
  queued.add(id);
  queue.push({ id, url });
  pump();
}

/** Synchronous read — undefined until the score has resolved. */
export function peekCalm(id: string): CalmResult | undefined {
  return cache.get(id);
}

/** Fire-and-forget: schedule computation for one artwork if not already known. */
export function requestCalm(artwork: Artwork): void {
  enqueue(artwork.id, artwork.imageThumb);
}

/** Schedule computation for every artwork in a list not already known/queued. */
export function requestCalmForAll(artworks: Artwork[]): void {
  for (const a of artworks) enqueue(a.id, a.imageThumb);
}

/** React hook: current score for an artwork, triggering lazy computation on mount. */
export function useCalmScore(artwork: Artwork): CalmResult | undefined {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cache.has(artwork.id)) return;
    requestCalm(artwork);
  }, [artwork]);
  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return cache.get(artwork.id);
}

/** Subscribe to any score resolving — used to re-trigger a "calmest first" re-sort. */
export function subscribeCalm(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
