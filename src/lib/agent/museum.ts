import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { enabledSources, getArtworkById } from "@/lib/adapters";
import { cachedSearch } from "@/lib/search-cache";
import { serverCanFetch } from "@/lib/source-egress";
import { smallThumb } from "@/lib/thumb";
import type { Artwork, SourceId } from "@/lib/types";
import type {
  CurioUIMessage,
  ExhibitData,
  StepData,
  StepItem,
} from "@/lib/thread/types";

/**
 * The curator's three tools, written once. Each executor does the work AND
 * narrates it: it writes `data-step` parts (and the `data-exhibit` part) into
 * the turn's UI stream as it goes, so the thread shows the same live steps
 * whichever engine is driving — the hosted AI SDK tool loop or the local
 * Claude Code session calling them over in-process MCP.
 */

export const TOOL_SOURCE_IDS = ["aic", "cma", "met", "smk", "mia", "rijks", "harvard"] as const;
export const VIEW_LIMIT = 8;
const PREVIEW_ITEMS = 5;

const SOURCE_LABELS: Record<SourceId, string> = {
  aic: "Art Institute of Chicago",
  cma: "Cleveland Museum of Art",
  met: "The Met",
  rijks: "Rijksmuseum",
  smk: "Statens Museum for Kunst",
  mia: "Minneapolis Institute of Art",
  harvard: "Harvard Art Museums",
};

export interface ViewedImage {
  label: string;
  data: string;
  mimeType: "image/png" | "image/jpeg";
}

/** Per-turn state the executors share. */
export interface MuseumContext {
  /** full records from this turn's searches, so ids resolve without a refetch */
  cache: Map<string, Artwork>;
  /** ids the model has actually seen a thumbnail of */
  viewed: Set<string>;
  writer: UIMessageStreamWriter<CurioUIMessage>;
  signal?: AbortSignal;
  /** true on the hosted engine: AIC thumbnails can't be fetched from there */
  hosted: boolean;
  /** hosted engine: thumbnails not yet shown to the model (see route) */
  pendingImages: ViewedImage[];
  /** the exhibit, once present_selection has run */
  exhibit?: ExhibitData;
  /** its data-part id: a second call rewrites the same part */
  exhibitId?: string;
  nextId: (prefix: string) => string;
}

export function createMuseumContext(
  writer: UIMessageStreamWriter<CurioUIMessage>,
  opts: { hosted: boolean; signal?: AbortSignal },
): MuseumContext {
  let n = 0;
  return {
    cache: new Map(),
    viewed: new Set(),
    writer,
    signal: opts.signal,
    hosted: opts.hosted,
    pendingImages: [],
    nextId: (prefix) => `${prefix}-${Date.now().toString(36)}-${++n}`,
  };
}

function writeStep(ctx: MuseumContext, id: string, data: StepData) {
  ctx.writer.write({ type: "data-step", id, data });
}

function itemOf(a: Artwork, state: StepItem["state"]): StepItem {
  return { id: a.id, title: a.title, artist: a.artist, thumb: smallThumb(a), state };
}

/** "1600–1720" / "after 1850" / "before 1700" / undefined */
export function formatYears(from?: number, to?: number): string | undefined {
  if (from !== undefined && to !== undefined) return `${from}–${to}`;
  if (from !== undefined) return `after ${from}`;
  if (to !== undefined) return `before ${to}`;
  return undefined;
}

async function resolve(ctx: MuseumContext, id: string): Promise<Artwork | null> {
  const cached = ctx.cache.get(id);
  if (cached) return cached;
  const fetched = await getArtworkById(id).catch(() => null);
  if (fetched) ctx.cache.set(fetched.id, fetched);
  return fetched;
}

// — schemas (zod objects: the AI SDK tool() and the Agent SDK tool() both take them)

export const searchInput = z.object({
  q: z.string().optional().describe("keyword query, e.g. 'nocturne', 'mist', 'still life'"),
  artist: z.string().optional().describe("artist name, e.g. 'Monet'"),
  source: z
    .enum(TOOL_SOURCE_IDS)
    .optional()
    .describe("restrict to one museum; omit to search all"),
  yearFrom: z.number().optional(),
  yearTo: z.number().optional(),
  limit: z.number().optional().describe("per museum, default 24"),
});

export const viewInput = z.object({
  ids: z
    .array(z.string())
    .describe('up to 8 artwork ids ("source:nativeId") from search_artworks results'),
});

export const exhibitInput = z.object({
  artworkIds: z
    .array(z.string())
    .describe("ids of works you have looked at: usually 6-12, or exactly the number asked for"),
  title: z
    .string()
    .describe("a short exhibit title, 2-6 words, sentence case, e.g. 'Cats with opinions'"),
  note: z
    .string()
    .describe("two or three sentences in your own voice: what the works share, and where to start"),
  followUps: z
    .array(z.string())
    .describe("2-3 short refinements the visitor might ask for next, e.g. 'warmer', 'only prints'"),
});

export const TOOL_DESCRIPTIONS = {
  search_artworks:
    "Search the museums' open-access collections (CC0 / public domain, with images). Returns compact rows: id, title, artist, date, source. No images: it can't tell you what anything looks like. Run a few variations before deciding.",
  view_artworks:
    "Look at the actual images of up to 8 works from your search results. Use it before choosing: you judge what you see, not titles.",
  present_selection:
    "Curate the exhibit: put the works you chose (usually 6-12, or exactly the number asked for, all ones you have looked at) on the visitor's wall, with a title, a short note in your own voice, and 2-3 follow-up suggestions. Call exactly once, as the last thing you do in the turn.",
} as const;

// — executors

/** Once the exhibit is up the turn is over: further searching or looking
 *  does no work and shows no step (the local engine can't be stopped at
 *  present_selection, and a model sometimes keeps polishing). */
const TURN_OVER = "The exhibit is already up and the turn is over. Stop now and write nothing more.";

export async function searchArtworks(
  args: z.infer<typeof searchInput>,
  ctx: MuseumContext,
): Promise<string> {
  if (ctx.exhibit) return TURN_OVER;
  const id = ctx.nextId("step");
  const terms = [args.artist, args.q].filter(Boolean).join(" · ") || undefined;
  const base: StepData = {
    kind: "search",
    phase: "running",
    startedAt: Date.now(),
    terms,
    years: formatYears(args.yearFrom, args.yearTo),
    source: args.source ? SOURCE_LABELS[args.source] : undefined,
  };
  writeStep(ctx, id, base);

  const sources: SourceId[] = args.source ? [args.source] : enabledSources();
  const dateRange: [number, number] | undefined =
    args.yearFrom !== undefined || args.yearTo !== undefined
      ? [args.yearFrom ?? -3000, args.yearTo ?? 2100]
      : undefined;

  try {
    const { artworks, errors } = await cachedSearch(sources, {
      q: args.q,
      artist: args.artist,
      dateRange,
      limit: args.limit,
    });
    for (const a of artworks) ctx.cache.set(a.id, a);
    writeStep(ctx, id, {
      ...base,
      phase: "done",
      endedAt: Date.now(),
      count: artworks.length,
      museums: new Set(artworks.map((a) => a.source)).size,
      unavailable: errors.map((e) => SOURCE_LABELS[e.source] ?? e.source),
      items: artworks.slice(0, PREVIEW_ITEMS).map((a) => itemOf(a, "seen")),
    });
    const rows = artworks.map((a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      date: a.date,
      source: a.source,
    }));
    const errNote = errors.length
      ? ` (didn't answer: ${errors.map((e) => e.source).join(", ")})`
      : "";
    return `${rows.length} results${errNote}\n${JSON.stringify(rows)}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeStep(ctx, id, { ...base, phase: "error", endedAt: Date.now(), error: message });
    return `search failed: ${message}`;
  }
}

/** Fetch a downsized thumbnail for the model to look at. */
const MAX_IMAGE_BYTES = 1_500_000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) curio/1.0";

async function fetchThumbBase64(
  artwork: Artwork,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: "image/png" | "image/jpeg" } | { error: string }> {
  const url = smallThumb(artwork, 400);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": BROWSER_UA, accept: "image/*,*/*;q=0.8" },
      signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) return { error: "image too large" };
    const type = res.headers.get("content-type") ?? "";
    const mimeType = type.startsWith("image/png") ? "image/png" : "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch failed" };
  }
}

export async function viewArtworks(
  args: z.infer<typeof viewInput>,
  ctx: MuseumContext,
): Promise<{ text: string; images: ViewedImage[] }> {
  if (ctx.exhibit) return { text: TURN_OVER, images: [] };
  const id = ctx.nextId("step");
  const requested = Array.isArray(args.ids) ? args.ids : [];
  const ids = requested.slice(0, VIEW_LIMIT);
  const startedAt = Date.now();

  const works = await Promise.all(ids.map((wid) => resolve(ctx, wid)));
  const items: StepItem[] = works.map((a, i) =>
    a
      ? itemOf(a, "loading")
      : { id: ids[i], title: "Unknown work", artist: "", thumb: "", state: "failed" as const },
  );
  const write = (phase: StepData["phase"]) =>
    writeStep(ctx, id, {
      kind: "look",
      phase,
      startedAt,
      endedAt: phase === "running" ? undefined : Date.now(),
      count: ids.length,
      items: items.map((x) => ({ ...x })),
    });
  write("running");

  // Fetch in parallel; each thumbnail that lands updates the strip in place.
  type Viewed =
    | { a: Artwork; image: { data: string; mimeType: "image/png" | "image/jpeg" } }
    | { a: Artwork; error: string };
  const results: (Viewed | null)[] = await Promise.all(
    works.map(async (a, i): Promise<Viewed | null> => {
      if (!a) return null;
      if (ctx.hosted && !serverCanFetch(a.source)) {
        items[i].state = "failed";
        write("running");
        return { a, error: "can't be viewed from this server" };
      }
      const thumb = await fetchThumbBase64(a, ctx.signal);
      items[i].state = "error" in thumb ? "failed" : "seen";
      write("running");
      return "error" in thumb ? { a, error: thumb.error } : { a, image: thumb };
    }),
  );
  write("done");

  const lines: string[] = [];
  const images: ViewedImage[] = [];
  if (requested.length > VIEW_LIMIT) {
    lines.push(`capped to the first ${VIEW_LIMIT} of ${requested.length} requested ids`);
  }
  results.forEach((r, i) => {
    if (!r) {
      lines.push(`${ids[i]}: not found`);
      return;
    }
    const label = `${r.a.id} · ${r.a.title} · ${r.a.artist} · ${r.a.date}`;
    if ("error" in r) {
      lines.push(`${label}: image unavailable (${r.error}). Don't retry it.`);
      return;
    }
    images.push({ label, data: r.image.data, mimeType: r.image.mimeType });
    lines.push(`image ${images.length}: ${label}`);
    ctx.viewed.add(r.a.id);
  });
  return { text: lines.join("\n") || "nothing to view", images };
}

export async function presentExhibit(
  args: z.infer<typeof exhibitInput>,
  ctx: MuseumContext,
): Promise<string> {
  const id = ctx.nextId("step");
  const startedAt = Date.now();
  writeStep(ctx, id, { kind: "exhibit", phase: "running", startedAt });
  const ids = Array.isArray(args.artworkIds) ? args.artworkIds : [];
  const resolved = (await Promise.all(ids.map((wid) => resolve(ctx, wid)))).filter(
    (a): a is Artwork => !!a,
  );
  const exhibit: ExhibitData = {
    title: args.title?.trim() || "An exhibit",
    note: args.note?.trim() ?? "",
    artworks: resolved,
    followUps: (args.followUps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3),
  };
  // One exhibit per turn. The local engine can't be stopped at this tool the
  // way the hosted loop is (hasToolCall), and a model occasionally calls it
  // twice; the second call rewrites the same part instead of adding another.
  const again = Boolean(ctx.exhibit);
  ctx.exhibit = exhibit;
  ctx.exhibitId ??= ctx.nextId("exhibit");
  ctx.writer.write({ type: "data-exhibit", id: ctx.exhibitId, data: exhibit });
  writeStep(ctx, id, {
    kind: "exhibit",
    phase: "done",
    startedAt,
    endedAt: Date.now(),
    count: resolved.length,
  });
  return again
    ? `replaced the exhibit with these ${resolved.length} works. The turn is over: stop here and write nothing more.`
    : `curated an exhibit of ${resolved.length} works for the visitor. The turn is over: stop here and write nothing more.`;
}

/**
 * The time budget ran out before the model curated anything: put what it
 * actually looked at on the wall (or, failing that, its first search hits)
 * rather than leave the visitor with nothing.
 */
export function fallbackExhibit(ctx: MuseumContext): ExhibitData | null {
  const viewed = [...ctx.viewed].map((i) => ctx.cache.get(i)).filter((a): a is Artwork => !!a);
  const pool = viewed.length > 0 ? viewed : [...ctx.cache.values()];
  const picks = pool.slice(0, 12);
  if (picks.length === 0) return null;
  return {
    title: "A first pass",
    note: "I ran out of time before I could finish choosing, so here is what I had in hand. Ask me to keep going and I'll go deeper.",
    artworks: picks,
    followUps: ["Keep going", "Narrow it down"],
    fallback: true,
  };
}
