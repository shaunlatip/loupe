import type { Artwork, SearchQuery, SourceAdapter } from "@/lib/types";

/**
 * Rijksmuseum — rijksmuseum.nl/api. Requires RIJKSMUSEUM_API_KEY; the
 * adapter stays disabled without one. Images come as Google-hosted URLs
 * ending in `=s0` (full size) — swap the suffix for sized variants.
 */

const API = "https://www.rijksmuseum.nl/api/en/collection";

interface RijksWebImage {
  url: string;
  width?: number;
  height?: number;
}

interface RijksItem {
  objectNumber: string;
  title: string;
  principalOrFirstMaker: string | null;
  longTitle: string | null;
  webImage: RijksWebImage | null;
}

function key(): string {
  return process.env.RIJKSMUSEUM_API_KEY ?? "";
}

/** "The Milkmaid, Johannes Vermeer, c. 1660" → "c. 1660" (best-effort). */
function dateFromLongTitle(longTitle: string | null): string {
  if (!longTitle) return "";
  const idx = longTitle.lastIndexOf(",");
  if (idx === -1) return "";
  const tail = longTitle.slice(idx + 1).trim();
  // Only treat the tail as a date if it contains a digit
  return /\d/.test(tail) ? tail : "";
}

function thumbUrl(url: string): string {
  return url.endsWith("=s0") ? `${url.slice(0, -3)}=s800` : url;
}

function toArtwork(item: RijksItem): Artwork | null {
  if (!item.webImage?.url) return null;
  return {
    id: `rijks:${item.objectNumber}`,
    source: "rijks",
    nativeId: item.objectNumber,
    title: item.title ?? "Untitled",
    artist: item.principalOrFirstMaker || "Unknown",
    date: dateFromLongTitle(item.longTitle),
    imageThumb: thumbUrl(item.webImage.url),
    imageHires: item.webImage.url,
    license: "Public Domain",
    sourceUrl: `https://www.rijksmuseum.nl/en/collection/${item.objectNumber}`,
    dims:
      item.webImage.width && item.webImage.height
        ? { width: item.webImage.width, height: item.webImage.height }
        : undefined,
  };
}

export const rijks: SourceAdapter = {
  id: "rijks",
  label: "Rijksmuseum",
  enabled: () => !!process.env.RIJKSMUSEUM_API_KEY,

  async search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]> {
    const limit = q.limit ?? 50;
    const f = q.facets?.rijks;
    const params = new URLSearchParams({
      key: key(),
      imgonly: "True",
      ps: String(limit),
    });
    const terms = [q.q, f?.q].filter(Boolean).join(" ");
    if (terms) params.set("q", terms);
    if (q.artist) params.set("involvedMaker", q.artist);
    if (f?.type) params.set("type", f.type);
    if (f?.material) params.set("material", f.material);
    if (f?.technique) params.set("technique", f.technique);
    // f.dating.period is a century bucket (e.g. 17 = 17th century)
    if (f?.datingPeriod != null) params.set("f.dating.period", String(f.datingPeriod));
    // No year-range param in this API — skip top-level dateRange
    const res = await fetch(`${API}?${params}`, { signal });
    if (!res.ok) throw new Error(`Rijksmuseum search failed: ${res.status}`);
    const json = (await res.json()) as { artObjects: RijksItem[] };
    return (json.artObjects ?? [])
      .map(toArtwork)
      .filter((a): a is Artwork => a !== null);
  },

  async getById(nativeId: string): Promise<Artwork | null> {
    const res = await fetch(
      `${API}/${encodeURIComponent(nativeId)}?key=${key()}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { artObject: RijksItem | null };
    return json.artObject ? toArtwork(json.artObject) : null;
  },
};
