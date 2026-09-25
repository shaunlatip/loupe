/**
 * Recorded example runs (public/examples/<slug>.json, written by
 * scripts/record-examples.mjs). Fetched once and kept; warmed on hover or
 * focus so a click replays with everything already in hand.
 */

export interface RecordedPart {
  type: string;
  id?: string;
  text?: string;
  data?: unknown;
  /** ms from the start of the run when the part first appeared */
  at: number;
  /** ms when a data part took its final value */
  doneAt?: number;
}

export interface Recording {
  slug: string;
  prompt: string;
  recordedAt: string;
  durationMs: number;
  metadata?: { model?: string; engine?: string };
  parts: RecordedPart[];
}

const cache = new Map<string, Promise<Recording | null>>();

export function loadRecording(slug: string): Promise<Recording | null> {
  let p = cache.get(slug);
  if (!p) {
    p = fetch(`/examples/${slug}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Recording>) : null))
      .then((rec) => (rec?.parts?.some((x) => x.type === "data-exhibit") ? rec : null))
      .catch(() => null);
    // a failed fetch shouldn't stick: let the next hover try again
    void p.then((rec) => {
      if (!rec) cache.delete(slug);
    });
    cache.set(slug, p);
  }
  return p;
}

const warmed = new Set<string>();

/** Fetch the recording and the thumbnails the replay will show first. Skipped
 *  on metered connections (Save-Data). */
export function warmRecording(slug: string): void {
  if (warmed.has(slug)) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  warmed.add(slug);
  void loadRecording(slug).then((rec) => {
    if (!rec) {
      warmed.delete(slug);
      return;
    }
    // what the look strips show, then the first row of the wall
    const thumbs = new Set<string>();
    const wall: string[] = [];
    for (const p of rec.parts) {
      const d = p.data as { items?: { thumb?: string }[]; artworks?: { imageThumb?: string }[] } | undefined;
      d?.items?.forEach((i) => i.thumb && thumbs.add(i.thumb));
      d?.artworks?.forEach((a) => a.imageThumb && wall.push(a.imageThumb));
    }
    for (const src of [...[...thumbs].slice(0, 24), ...wall.slice(0, 8)]) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = src;
    }
  });
}
