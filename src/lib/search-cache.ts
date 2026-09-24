import { searchSources } from "@/lib/adapters";
import type { SearchQuery, SearchResponse, SourceId } from "@/lib/types";

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
