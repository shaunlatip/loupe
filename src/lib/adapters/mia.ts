import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";

/**
 * Minneapolis Institute of Art (Mia) — the keyless Elasticsearch endpoint at
 * search.artsmia.org. The path segment IS a Lucene query string; public-domain
 * + has-image are ANDed into it server-side and never user-facing. Records
 * carry no image URL — thumb/hi-res are constructed from `Cache_Location` +
 * `Primary_RenditionNumber` against the live CDN `img.artsmia.org` (the
 * documented api.artsmia.org / iiif.dx.artsmia.org hosts are dead). Unofficial
 * endpoint — accepted risk per the plan.
 */

const SEARCH = "https://search.artsmia.org";
const CDN = "https://img.artsmia.org/web_objects_cache";

interface MiaSource {
  id: number;
  title?: string | null;
  artist?: string | null;
  dated?: string | null;
  medium?: string | null;
  classification?: string | null;
  accession_number?: string | null;
  image?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  Cache_Location?: string | null;
  Primary_RenditionNumber?: string | null;
}
interface MiaHit {
  _id: string;
  _source: MiaSource;
}
interface MiaResponse {
  hits?: { hits?: MiaHit[] };
}

/** Build a CDN image URL from the record's cache fields. `_800` or `_full`. */
function imageUrl(r: MiaSource, variant: "800" | "full"): string | null {
  if (!r.Cache_Location || !r.Primary_RenditionNumber) return null;
  const dir = r.Cache_Location.replace(/\\/g, "/");
  const stem = r.Primary_RenditionNumber.replace(/\.jpg$/i, "");
  return `${CDN}/${dir}/${stem}_${variant}.jpg`;
}

function toArtwork(r: MiaSource): Artwork | null {
  const thumb = imageUrl(r, "800");
  const hires = imageUrl(r, "full");
  if (!thumb || !hires) return null;
  return {
    id: `mia:${r.id}`,
    source: "mia",
    nativeId: String(r.id),
    title: r.title ?? "Untitled",
    artist: r.artist || "Unknown",
    date: r.dated ?? "",
    imageThumb: thumb,
    imageHires: hires,
    license: "Public Domain",
    sourceUrl: `https://collections.artsmia.org/art/${r.id}`,
    accession: r.accession_number ?? undefined,
    medium: r.medium ?? undefined,
    dims:
      r.image_width && r.image_height
        ? { width: r.image_width, height: r.image_height }
        : undefined,
  };
}

/** Quote a term for the Lucene path query when it contains spaces. */
function term(field: string, value: string): string {
  return `${field}:"${value.replace(/"/g, "")}"`;
}

async function run(query: string, limit: number, signal?: AbortSignal) {
  const url = `${SEARCH}/${encodeURIComponent(query)}?size=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Mia search failed: ${res.status}`);
  const json = (await res.json()) as MiaResponse;
  return (json.hits?.hits ?? [])
    .map((h) => toArtwork(h._source))
    .filter((a): a is Artwork => a !== null);
}

export const mia: SourceAdapter = {
  id: "mia",
  label: "Minneapolis Institute of Art",
  enabled: () => true,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.mia;
    // Always-on: public domain + a valid image. Then free text and facets, all
    // ANDed into one Lucene query string (the path segment).
    const clauses = [
      "image:valid",
      "public_access:1",
      term("rights_type", "Public Domain"),
    ];
    const text = [q.q, f?.q].filter(Boolean).join(" ").trim();
    if (text) clauses.unshift(text);
    if (q.artist) clauses.push(term("artist", q.artist));
    if (f?.classification) clauses.push(term("classification", f.classification));
    if (f?.department) clauses.push(term("department", f.department));
    if (f?.country) clauses.push(term("country", f.country));
    return run(clauses.join(" AND "), limit, signal);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const [only] = await run(`id:${nativeId}`, 1);
    return only ?? null;
  },
};
