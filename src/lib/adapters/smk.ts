import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";
import { hexToHsl } from "@/lib/color";

/**
 * Statens Museum for Kunst (SMK, Denmark) — api.smk.dk. Keyless. CC0/public-
 * domain + has-image are baked in server-side via the `filters` param. Native
 * hi-res over IIIF (`image_native`), pixel dims, and a `colors[]` hex palette
 * that joins AIC in the color sort. Filter *values* are Danish
 * (`object_names:maleri` = painting, `creator_nationality:hollandsk` = Dutch).
 */

const API = "https://api.smk.dk/api/v1/art";
const FIELDS =
  "object_number,titles,artist,production,production_date,techniques,image_native,image_thumbnail,image_width,image_height,colors";

interface SmkTitle {
  title: string;
  type?: string;
}
interface SmkProductionDate {
  start?: string;
  end?: string;
  period?: string;
}
interface SmkProduction {
  creator?: string;
}
interface SmkRecord {
  object_number: string;
  titles?: SmkTitle[] | null;
  artist?: string[] | null;
  production?: SmkProduction[] | null;
  production_date?: SmkProductionDate[] | null;
  techniques?: string[] | null;
  image_native?: string | null;
  image_thumbnail?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  colors?: string[] | null;
}

/** ISO date string → year, or undefined. */
function year(iso?: string): number | undefined {
  if (!iso) return undefined;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : undefined;
}

function toArtwork(r: SmkRecord): Artwork | null {
  if (!r.image_native || !r.object_number) return null;
  const color = r.colors?.[0] ? hexToHsl(r.colors[0]) : undefined;
  return {
    id: `smk:${r.object_number}`,
    source: "smk",
    nativeId: r.object_number,
    title: r.titles?.[0]?.title ?? "Untitled",
    artist: r.artist?.[0] ?? r.production?.[0]?.creator ?? "Unknown",
    date: r.production_date?.[0]?.period ?? "",
    imageThumb: r.image_thumbnail ?? r.image_native,
    imageHires: r.image_native,
    license: "Public Domain",
    sourceUrl: `https://open.smk.dk/en/artwork/image/${r.object_number}`,
    accession: r.object_number,
    medium: r.techniques?.[0] ?? undefined,
    dims:
      r.image_width && r.image_height
        ? { width: r.image_width, height: r.image_height }
        : undefined,
    color,
  };
}

export const smk: SourceAdapter = {
  id: "smk",
  label: "Statens Museum for Kunst",
  enabled: () => true,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.smk;
    // `keys` is SMK's free-text search; merge manual q + artist + facet keyword.
    // Empty search must be "*" (match-all) so a facet-only browse still returns.
    const keys = [q.q, q.artist, f?.q].filter(Boolean).join(" ") || "*";

    // The `filters` param is a comma-joined list of [field:value] entries.
    const filters = ["[has_image:true]", "[public_domain:true]"];
    if (f?.objectName) filters.push(`[object_names:${f.objectName}]`);
    if (f?.nationality) filters.push(`[creator_nationality:${f.nationality}]`);
    if (f?.technique) filters.push(`[techniques:${f.technique}]`);

    const params = new URLSearchParams({
      keys,
      filters: filters.join(","),
      rows: String(limit),
      fields: FIELDS,
    });
    const res = await fetch(`${API}/search/?${params}`, { signal });
    if (!res.ok) throw new Error(`SMK search failed: ${res.status}`);
    const json = (await res.json()) as { items?: SmkRecord[] };
    let items = json.items ?? [];

    // No reliable server-side date filter — narrow client-side (like CMA) when
    // a top-level range is present. Keep records with no dated production.
    if (q.dateRange) {
      const [from, to] = q.dateRange;
      items = items.filter((r) => {
        const dates = r.production_date ?? [];
        if (dates.length === 0) return true;
        return dates.some((d) => {
          const s = year(d.start);
          const e = year(d.end) ?? s;
          if (s == null) return true;
          return (e ?? s) >= from && s <= to;
        });
      });
    }
    return items.map(toArtwork).filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const params = new URLSearchParams({ object_number: nativeId });
    const res = await fetch(`${API}/?${params}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: SmkRecord[] };
    const record = json.items?.[0];
    return record ? toArtwork(record) : null;
  },
};
