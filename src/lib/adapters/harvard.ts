import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";
import { hexToHsl } from "@/lib/color";

/**
 * Harvard Art Museums — api.harvardartmuseums.org. Requires HARVARD_API_KEY
 * (free, form-issued: harvardartmuseums.org/collections/api); the adapter
 * stays dormant without one, same gate as rijks. Rights are per-record:
 * `imagepermissionlevel=0` restricts to the freely-reusable subset. Harvard's
 * own `colors[]` (museum-computed) join AIC in the color sort. Images come
 * over IIIF (`images[].iiifbaseuri`). Untested until a key lands — mapping
 * follows the documented Object schema.
 */

const API = "https://api.harvardartmuseums.org/object";

interface HarvardPerson {
  name?: string;
  role?: string;
}
interface HarvardImage {
  baseimageurl?: string;
  iiifbaseuri?: string;
  width?: number;
  height?: number;
}
interface HarvardColor {
  color?: string;
  hue?: string;
  percent?: number;
}
interface HarvardRecord {
  id: number;
  objectnumber?: string | null;
  title?: string | null;
  people?: HarvardPerson[] | null;
  dated?: string | null;
  classification?: string | null;
  medium?: string | null;
  accessionnumber?: string | null;
  url?: string | null;
  primaryimageurl?: string | null;
  imagepermissionlevel?: number | null;
  images?: HarvardImage[] | null;
  colors?: HarvardColor[] | null;
}

function key(): string {
  return process.env.HARVARD_API_KEY ?? "";
}

/** Prefer the recorded artist, else the first named person. */
function artistOf(people?: HarvardPerson[] | null): string {
  if (!people?.length) return "Unknown";
  const artist = people.find((p) => p.role === "Artist");
  return artist?.name ?? people[0]?.name ?? "Unknown";
}

function toArtwork(r: HarvardRecord): Artwork | null {
  // Freely-reusable only. `imagepermissionlevel` 0 = display without
  // restriction; anything else (or missing) is excluded.
  if (r.imagepermissionlevel !== 0) return null;
  const img = r.images?.[0];
  const iiif = img?.iiifbaseuri;
  const thumb = iiif
    ? `${iiif}/full/843,/0/default.jpg`
    : (r.primaryimageurl ?? img?.baseimageurl ?? null);
  const hires = iiif
    ? `${iiif}/full/full/0/default.jpg`
    : (r.primaryimageurl ?? img?.baseimageurl ?? null);
  if (!thumb || !hires) return null;
  const color = r.colors?.[0]?.color ? hexToHsl(r.colors[0].color) : undefined;
  return {
    id: `harvard:${r.id}`,
    source: "harvard",
    nativeId: String(r.id),
    title: r.title ?? "Untitled",
    artist: artistOf(r.people),
    date: r.dated ?? "",
    imageThumb: thumb,
    imageHires: hires,
    license: "Public Domain",
    sourceUrl: r.url ?? `https://www.harvardartmuseums.org/collections/object/${r.id}`,
    accession: r.objectnumber ?? r.accessionnumber ?? undefined,
    medium: r.medium ?? undefined,
    dims:
      img?.width && img?.height
        ? { width: img.width, height: img.height }
        : undefined,
    color,
  };
}

export const harvard: SourceAdapter = {
  id: "harvard",
  label: "Harvard Art Museums",
  enabled: () => !!process.env.HARVARD_API_KEY,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.harvard;
    const terms = [q.q, q.artist, f?.q].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      apikey: key(),
      hasimage: "1",
      imagepermissionlevel: "0",
      size: String(limit),
      fields:
        "id,objectnumber,title,people,dated,classification,medium,accessionnumber,url,primaryimageurl,imagepermissionlevel,images,colors",
    });
    if (terms) params.set("q", terms);
    if (f?.classification) params.set("classification", f.classification);
    if (f?.century) params.set("century", f.century);
    if (f?.culture) params.set("culture", f.culture);
    if (f?.medium) params.set("medium", f.medium);
    const res = await fetch(`${API}?${params}`, { signal });
    if (!res.ok) throw new Error(`Harvard search failed: ${res.status}`);
    const json = (await res.json()) as { records?: HarvardRecord[] };
    return (json.records ?? [])
      .map(toArtwork)
      .filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const params = new URLSearchParams({ apikey: key() });
    const res = await fetch(`${API}/${encodeURIComponent(nativeId)}?${params}`);
    if (!res.ok) return null;
    const json = (await res.json()) as HarvardRecord;
    return json?.id ? toArtwork(json) : null;
  },
};
