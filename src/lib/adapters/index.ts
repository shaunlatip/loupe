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

export async function searchSources(
  sources: SourceId[],
  q: SearchQuery,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const active = sources
    .map((s) => ADAPTERS[s])
    .filter((a): a is SourceAdapter => !!a && a.enabled());

  const settled = await Promise.allSettled(
    active.map((a) => a.search(q, signal)),
  );

  const lists: Artwork[][] = [];
  const errors: SearchResponse["errors"] = [];
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
  return adapter.getById(nativeId);
}
