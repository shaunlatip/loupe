import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";

/**
 * Art Institute of Chicago — api.artic.edu. Keyless, CC0 subset via
 * is_public_domain, images over IIIF.
 */

const API = "https://api.artic.edu/api/v1/artworks";
const FIELDS =
  "id,title,artist_display,artist_title,date_display,date_start,image_id,is_public_domain,main_reference_number,medium_display,thumbnail,color";

interface AicRecord {
  id: number;
  title: string;
  artist_display: string | null;
  artist_title: string | null;
  date_display: string | null;
  image_id: string | null;
  is_public_domain: boolean;
  main_reference_number: string | null;
  medium_display: string | null;
  thumbnail: { width?: number; height?: number } | null;
  /** dominant-color analysis; null for many records */
  color: { h: number; s: number; l: number; percentage?: number; population?: number } | null;
}

function iiif(imageId: string, size: string): string {
  return `https://www.artic.edu/iiif/2/${imageId}/full/${size}/0/default.jpg`;
}

/**
 * AIC category-terms vocabulary resolver. Names → ids via
 * /category-terms/search, filtered by subtype (style/subject/classification/
 * department). Cached module-level so a category chip resolves each name once.
 * Returns null when nothing matches — callers then skip that filter.
 */
type AicTermKind = "style" | "subject" | "classification" | "department";
const termCache = new Map<string, string | null>();

interface AicCategoryTerm {
  id: string;
  title: string;
  subtype: string;
}

async function resolveTermId(
  kind: AicTermKind,
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cacheKey = `${kind}:${name.toLowerCase()}`;
  if (termCache.has(cacheKey)) return termCache.get(cacheKey) ?? null;

  let id: string | null = null;
  try {
    // subtype is only populated when explicitly requested via fields
    const params = new URLSearchParams({
      q: name,
      limit: "10",
      fields: "id,title,subtype",
    });
    const res = await fetch(
      `https://api.artic.edu/api/v1/category-terms/search?${params}`,
      { signal },
    );
    if (res.ok) {
      const json = (await res.json()) as { data: AicCategoryTerm[] };
      const candidates = (json.data ?? []).filter((t) => t.subtype === kind);
      const lower = name.toLowerCase();
      const exact = candidates.find((t) => t.title.toLowerCase() === lower);
      id = (exact ?? candidates[0])?.id ?? null;
    }
  } catch {
    id = null;
  }
  termCache.set(cacheKey, id);
  return id;
}

function toArtwork(r: AicRecord): Artwork | null {
  if (!r.image_id || !r.is_public_domain) return null;
  return {
    id: `aic:${r.id}`,
    source: "aic",
    nativeId: String(r.id),
    title: r.title ?? "Untitled",
    artist: r.artist_title ?? r.artist_display ?? "Unknown",
    date: r.date_display ?? "",
    imageThumb: iiif(r.image_id, "843,"),
    imageHires: iiif(r.image_id, "1686,"),
    license: "CC0",
    sourceUrl: `https://www.artic.edu/artworks/${r.id}`,
    accession: r.main_reference_number ?? undefined,
    medium: r.medium_display ?? undefined,
    // `thumbnail.width/height` is the original image's pixel size (AIC uses
    // it to size the lqip placeholder), not the ~800px thumbnail render —
    // so this already reflects real hi-res dims when AIC knows them.
    dims:
      r.thumbnail?.width && r.thumbnail?.height
        ? { width: r.thumbnail.width, height: r.thumbnail.height }
        : undefined,
    color: r.color ? { h: r.color.h, s: r.color.s, l: r.color.l } : undefined,
  };
}

export const aic: SourceAdapter = {
  id: "aic",
  label: "Art Institute of Chicago",
  enabled: () => true,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.aic;
    const terms = [q.q, q.artist].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      q: terms,
      limit: String(limit),
      fields: FIELDS,
    });
    // Elasticsearch filters: public domain + has image
    params.set("query[bool][filter][0][term][is_public_domain]", "true");
    params.set("query[bool][filter][1][exists][field]", "image_id");
    // Additional filter entries append to the same bool.filter array. `n`
    // tracks the next free slot so nothing collides.
    let n = 2;
    // date range: top-level dateRange (manual) OR facet dateFrom/dateTo
    const from = f?.dateFrom ?? q.dateRange?.[0];
    const to = f?.dateTo ?? q.dateRange?.[1];
    if (from != null && to != null) {
      params.set(`query[bool][filter][${n}][range][date_start][gte]`, String(from));
      params.set(`query[bool][filter][${n}][range][date_start][lte]`, String(to));
      n++;
    }
    // Resolve vocabulary names → ids, then add each as a term filter.
    if (f) {
      const resolved = await Promise.all([
        f.styleName
          ? resolveTermId("style", f.styleName, signal).then(
              (id) => ["style_id", id] as const,
            )
          : null,
        f.subjectName
          ? resolveTermId("subject", f.subjectName, signal).then(
              (id) => ["subject_id", id] as const,
            )
          : null,
        f.classificationName
          ? resolveTermId("classification", f.classificationName, signal).then(
              (id) => ["classification_id", id] as const,
            )
          : null,
        f.departmentName
          ? resolveTermId("department", f.departmentName, signal).then(
              (id) => ["department_id", id] as const,
            )
          : null,
      ]);
      for (const entry of resolved) {
        if (!entry) continue;
        const [field, id] = entry;
        if (!id) continue; // unresolved name → skip this filter, don't error
        params.set(`query[bool][filter][${n}][term][${field}]`, id);
        n++;
      }
    }
    const res = await fetch(`${API}/search?${params}`, { signal });
    if (!res.ok) throw new Error(`AIC search failed: ${res.status}`);
    const json = (await res.json()) as { data: AicRecord[] };
    return json.data.map(toArtwork).filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const res = await fetch(`${API}/${nativeId}?fields=${FIELDS}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { data: AicRecord };
    return toArtwork(json.data);
  },
};
