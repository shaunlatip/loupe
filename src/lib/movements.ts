import artistMovements from "@/data/artist-movements.json";
import type { Artwork } from "@/lib/types";

/**
 * Runtime side of the Wikidata artist→movement join (AGENTS.md backlog item
 * #1, "the big lever"). `src/data/artist-movements.json` is a static,
 * committed artifact built once by `scripts/build-movements.mjs` from
 * Wikidata property P135 (movement) — see that script's header comment for
 * how it was generated. The app never fetches Wikidata at runtime; this
 * module only reads the committed JSON and joins it against already-fetched
 * artworks client-side.
 *
 * NOTE: normalizeName()/nameKeys() below MUST stay byte-for-byte identical
 * to the copies in scripts/build-movements.mjs — a build-time key only
 * matches a runtime lookup if both sides normalize artist names the same
 * way. Keep them in sync by hand.
 */

const MOVEMENTS: Record<string, string[]> = artistMovements;

function normalizeName(raw: string): string {
  if (!raw) return "";
  const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
  let s = raw.normalize("NFD").replace(COMBINING_MARKS, ""); // strip diacritics
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9,\s.'-]/g, ""); // drop punctuation noise, keep name-shape chars
  return s.trim().replace(/\s+/g, " ");
}

function nameKeys(raw: string): string[] {
  const norm = normalizeName(raw);
  if (!norm) return [];
  const keys = new Set([norm]);
  if (norm.includes(",")) {
    // "last, first" -> also try "first last"
    const [last, first] = norm.split(",").map((p) => p.trim());
    if (last && first) keys.add(`${first} ${last}`);
  } else {
    // "first last" -> also try "last, first" (museum artist strings
    // observed so far — AIC/Met/CMA — are all "First Last", but this keeps
    // the join defensive against future sources or Wikidata label shapes)
    const parts = norm.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      const first = parts.slice(0, -1).join(" ");
      const last = parts[parts.length - 1];
      keys.add(`${last}, ${first}`);
    }
  }
  return Array.from(keys);
}

/**
 * Movement(s) Wikidata records for an artist name, in whatever order the
 * calling museum API used. Best-effort name join — misses are expected for
 * spelling variants, artists outside the curated movement list (see the
 * build script), and workshop/attribution credit lines like "Follower of
 * Rembrandt" or "Attributed to X" (those don't match a person entity).
 */
export function movementsForArtist(artist: string): string[] {
  if (!artist) return [];
  for (const key of nameKeys(artist)) {
    const hit = MOVEMENTS[key];
    if (hit) return hit;
  }
  return [];
}

/**
 * Attaches `movements` to every artwork whose artist joins against the
 * lookup; artworks with no match pass through unchanged. Pure and
 * client-side only — this never touches the wire adapters (searchSources
 * stays untouched per the backlog plan), so it's meant to run once over a
 * fetched result set, e.g. in page.tsx right after setResults.
 */
export function enrichArtworksWithMovements(artworks: Artwork[]): Artwork[] {
  return artworks.map((a) => {
    const movements = movementsForArtist(a.artist);
    return movements.length > 0 ? { ...a, movements } : a;
  });
}
