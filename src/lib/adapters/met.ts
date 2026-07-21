import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";

/**
 * Met Open Access — collectionapi.metmuseum.org. Keyless two-step API:
 * search returns bare objectIDs, each object needs its own fetch. We cap
 * at the first 20 ids and fetch at ~8 concurrent, so results run thin.
 */

const API = "https://collectionapi.metmuseum.org/public/collection/v1";
const MAX_IDS = 50;
const CONCURRENCY = 8;

interface MetObject {
  objectID: number;
  isPublicDomain: boolean;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  primaryImage: string;
  primaryImageSmall: string;
  objectURL: string;
  accessionNumber: string;
  medium: string;
}

function toArtwork(o: MetObject): Artwork | null {
  if (!o.isPublicDomain || !o.primaryImageSmall) return null;
  return {
    id: `met:${o.objectID}`,
    source: "met",
    nativeId: String(o.objectID),
    title: o.title || "Untitled",
    artist: o.artistDisplayName || "Unknown",
    date: o.objectDate ?? "",
    imageThumb: o.primaryImageSmall,
    imageHires: o.primaryImage || o.primaryImageSmall,
    license: "Public Domain",
    sourceUrl: o.objectURL,
    accession: o.accessionNumber || undefined,
    medium: o.medium || undefined,
  };
}

async function fetchObject(id: number, signal?: AbortSignal): Promise<MetObject | null> {
  const res = await fetch(`${API}/objects/${id}`, { signal });
  if (!res.ok) return null;
  return (await res.json()) as MetObject;
}

export const met: SourceAdapter = {
  id: "met",
  label: "The Metropolitan Museum of Art",
  enabled: () => true,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const f = q.facets?.met;
    // facet.q carries a category's subject/movement term; merge with manual q
    const terms = [q.q, q.artist, f?.q].filter(Boolean).join(" ");
    const params = new URLSearchParams({ q: terms, hasImages: "true" });
    if (q.artist) params.set("artistOrCulture", "true");
    if (f?.tags) params.set("tags", "true");
    if (f?.departmentId != null) params.set("departmentId", String(f.departmentId));
    if (f?.medium) params.set("medium", f.medium);
    if (f?.geoLocation) params.set("geoLocation", f.geoLocation);
    // dateBegin/dateEnd only work as a pair — facet pair wins over manual range
    const dateBegin = f?.dateBegin ?? q.dateRange?.[0];
    const dateEnd = f?.dateEnd ?? q.dateRange?.[1];
    if (dateBegin != null && dateEnd != null) {
      params.set("dateBegin", String(dateBegin));
      params.set("dateEnd", String(dateEnd));
    }
    const res = await fetch(`${API}/search?${params}`, { signal });
    if (!res.ok) throw new Error(`Met search failed: ${res.status}`);
    const json = (await res.json()) as { objectIDs: number[] | null };
    const ids = (json.objectIDs ?? []).slice(0, MAX_IDS);

    const objects: MetObject[] = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map((id) => fetchObject(id, signal)),
      );
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          objects.push(result.value);
        }
      }
    }
    return objects.map(toArtwork).filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const obj = await fetchObject(Number(nativeId));
    return obj ? toArtwork(obj) : null;
  },
};
