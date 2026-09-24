import type {
  Artwork,
  SearchQuery,
  SearchResponse,
  SourceAdapter,
  SourceId,
} from "@/lib/types";
import { aic } from "./aic";
import { cma } from "./cma";
import { met } from "./met";
import { rijks } from "./rijks";
import { smk } from "./smk";
import { mia } from "./mia";
import { harvard } from "./harvard";

/**
 * Adapter registry + shared search fanout. This single code path backs both
 * manual search (/api/search) and the Claude curator's search_artworks tool.
 */

export const ADAPTERS: Record<string, SourceAdapter> = {
  aic,
  cma,
  met,
  rijks,
  smk,
  mia,
  harvard,
};

export function enabledSources(): SourceId[] {
  return Object.values(ADAPTERS)
    .filter((a) => a.enabled())
    .map((a) => a.id);
}

/** Round-robin interleave so one museum doesn't dominate the top of the grid. */
function interleave(lists: Artwork[][]): Artwork[] {
  const out: Artwork[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/**
 * How long one museum gets to answer a search. The fanout waits for every
 * museum, so without a deadline one that stops responding (SMK has gone
 * silent for minutes at a time) stalls the whole search, and with it the
 * wall and any curator turn. Past the deadline it counts as not answering.
 * The Met's two-step hydrate is the slowest healthy path, at 2–4s.
 */
const SEARCH_DEADLINE_MS = 10_000;
/** A single record by id (attachments, earlier works). */
const LOOKUP_DEADLINE_MS = 8_000;
/**
 * After a museum misses the deadline, skip it for a while instead of paying
 * the full wait on every search (a curator turn runs a dozen): it's reported
 * as not answering straight away, and tried again once this passes.
 */
const COOLDOWN_MS = 2 * 60 * 1000;
const downUntil = new Map<SourceId, number>();

export async function searchSources(
  sources: SourceId[],
  q: SearchQuery,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const now = Date.now();
  const enabled = sources
    .map((s) => ADAPTERS[s])
    .filter((a): a is SourceAdapter => !!a && a.enabled());
  const resting = enabled.filter((a) => (downUntil.get(a.id) ?? 0) > now);
  const active = enabled.filter((a) => !resting.includes(a));

  const settled = await Promise.allSettled(
    active.map(async (a) => {
      const deadline = AbortSignal.timeout(SEARCH_DEADLINE_MS);
      try {
        return await a.search(q, signal ? AbortSignal.any([signal, deadline]) : deadline);
      } catch (err) {
        if (deadline.aborted && !signal?.aborted) {
          downUntil.set(a.id, Date.now() + COOLDOWN_MS);
          throw new Error(`no answer in ${SEARCH_DEADLINE_MS / 1000}s`);
        }
        throw err;
      }
    }),
  );

  const lists: Artwork[][] = [];
  const errors: SearchResponse["errors"] = resting.map((a) => ({
    source: a.id,
    message: "not answering; skipped for a couple of minutes",
  }));
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      lists.push(result.value);
    } else {
      errors.push({
        source: active[i].id,
        message: String(result.reason?.message ?? result.reason),
      });
    }
  });

  // Dedupe by id (bundled queries can overlap)
  const seen = new Set<string>();
  const artworks = interleave(lists).filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  return { artworks, errors };
}

export async function getArtworkById(id: string): Promise<Artwork | null> {
  const [source, nativeId] = id.split(":");
  const adapter = ADAPTERS[source];
  if (!adapter || !nativeId) return null;
  // getById takes no signal; stop waiting rather than hold the turn open
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_DEADLINE_MS);
  });
  try {
    return await Promise.race([adapter.getById(nativeId), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
