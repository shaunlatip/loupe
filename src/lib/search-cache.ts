import { searchSources } from "@/lib/adapters";
import type { Artwork, SearchQuery, SearchResponse, SourceId } from "@/lib/types";

/**
 * A small in-memory cache in front of the museum fanout, shared by /api/search
 * and the curator's search_artworks. The same queries recur constantly (the
 * browse tags, a curator retrying a variation, a follow-up turn re-searching)
 * and museum APIs are the slowest thing in the app, so a warm instance
 * answers repeats instantly. Results that came back with errors are cached
 * briefly, so a museum that hiccuped gets another chance soon.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const PARTIAL_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, { at: number; ttl: number; value: SearchResponse }>();
const inflight = new Map<string, Promise<SearchResponse>>();

/**
 * Every record the fanout has returned lately, by id. A later curator turn
 * that refers to a work by id (from the wall, or an earlier exhibit) finds it
 * here instead of asking the museum again, which matters when a museum API is
 * slow or refusing this server (the Met's has blocked with 403s under load).
 */
const MAX_WORKS = 5000;
const works = new Map<string, Artwork>();

export function recentArtwork(id: string): Artwork | undefined {
  return works.get(id);
}

function remember(list: Artwork[]) {
  for (const a of list) {
    works.delete(a.id);
    works.set(a.id, a);
  }
  while (works.size > MAX_WORKS) {
    const oldest = works.keys().next().value;
    if (oldest === undefined) break;
    works.delete(oldest);
  }
}

/** Stable key: sorted sources + the query with its object keys sorted. */
function keyOf(sources: SourceId[], q: SearchQuery): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify([[...sources].sort(), sort(q)]);
}

export async function cachedSearch(
  sources: SourceId[],
  q: SearchQuery,
): Promise<SearchResponse> {
  const key = keyOf(sources, q);
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    // refresh recency for the LRU trim below
    store.delete(key);
    store.set(key, hit);
    return hit.value;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = searchSources(sources, q)
    .then((value) => {
      remember(value.artworks);
      store.set(key, {
        at: Date.now(),
        ttl: value.errors.length ? PARTIAL_TTL_MS : TTL_MS,
        value,
      });
      while (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
