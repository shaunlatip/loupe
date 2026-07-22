import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";

/**
 * Cleveland Museum of Art — openaccess-api.clevelandart.org. Keyless,
 * CC0 filter via cc0=1, direct CDN image URLs (web ≈1200px, print ≈3400px).
 */

const API = "https://openaccess-api.clevelandart.org/api/artworks";

interface CmaImage {
  url: string;
  width?: string;
  height?: string;
}

interface CmaRecord {
  id: number;
  title: string;
  creators: { description: string | null }[] | null;
  creation_date: string | null;
  creation_date_earliest: number | null;
  creation_date_latest: number | null;
  images: { web?: CmaImage | null; print?: CmaImage | null } | null;
  accession_number: string | null;
  technique: string | null;
  url: string | null;
  share_license_status: string | null;
}

/** "James McNeill Whistler (American, 1834–1903)" → "James McNeill Whistler" */
function cleanCreator(description: string): string {
  return description.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function toArtwork(r: CmaRecord): Artwork | null {
  const web = r.images?.web;
  if (!web?.url) return null;
  const print = r.images?.print;
  const hires = print?.url ? print : web;
  return {
    id: `cma:${r.id}`,
    source: "cma",
    nativeId: String(r.id),
    title: r.title ?? "Untitled",
    artist: r.creators?.[0]?.description
      ? cleanCreator(r.creators[0].description)
      : "Unknown",
    date: r.creation_date ?? "",
    imageThumb: web.url,
    imageHires: hires.url,
    license: r.share_license_status ?? "CC0",
    sourceUrl: r.url ?? `https://clevelandart.org/art/${r.id}`,
    accession: r.accession_number ?? undefined,
    medium: r.technique ?? undefined,
    dims:
      hires.width && hires.height
        ? { width: Number(hires.width), height: Number(hires.height) }
        : undefined,
  };
}

export const cma: SourceAdapter = {
  id: "cma",
  label: "Cleveland Museum of Art",
  enabled: () => true,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.cma;
    const params = new URLSearchParams({
      cc0: "1",
      has_image: "1",
      limit: String(limit),
    });
    // facet.q carries a category's subject term (CMA has no subject facet) —
    // merge with manual q, mirroring the Met adapter
    const terms = [q.q, f?.q].filter(Boolean).join(" ");
    if (terms) params.set("q", terms);
    // artists= composes with q= (verified live: artists=Whistler&q=nocturne)
    if (q.artist) params.set("artists", q.artist);
    if (f?.type) params.set("type", f.type);
    if (f?.technique) params.set("technique", f.technique);
    if (f?.department) params.set("department", f.department);
    if (f?.culture) params.set("culture", f.culture);
    if (f?.createdAfter != null) params.set("created_after", String(f.createdAfter));
    if (f?.createdBefore != null) params.set("created_before", String(f.createdBefore));
    const res = await fetch(`${API}/?${params}`, { signal });
    if (!res.ok) throw new Error(`CMA search failed: ${res.status}`);
    const json = (await res.json()) as { data: CmaRecord[] };
    let works = json.data;
    // No date param on the API — filter client-side when years are present
    if (q.dateRange) {
      const [from, to] = q.dateRange;
      works = works.filter((r) => {
        if (r.creation_date_earliest == null || r.creation_date_latest == null)
          return true;
        return r.creation_date_latest >= from && r.creation_date_earliest <= to;
      });
    }
    return works.map(toArtwork).filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const res = await fetch(`${API}/${nativeId}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { data: CmaRecord };
    return toArtwork(json.data);
  },
};
