import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { readAbout, readingText } from "@/lib/about";
import { enabledSources, getArtworkById } from "@/lib/adapters";
import { cachedSearch, recentArtwork } from "@/lib/search-cache";
import { serverCanFetch } from "@/lib/source-egress";
import { smallThumb } from "@/lib/thumb";
import type { Artwork, SourceId } from "@/lib/types";
import type {
  CurioUIMessage,
  ExhibitData,
  RevisionData,
  StepData,
  StepItem,
} from "@/lib/thread/types";

/**
 * The curator's five tools, written once. Each executor does the work AND
 * narrates it: it writes `data-step` parts (and the `data-exhibit` or
 * `data-revision` part) into the turn's UI stream as it goes, so the thread
 * shows the same live steps whichever engine is driving — the hosted AI SDK
 * tool loop or the local Claude Code session calling them over in-process MCP.
 */

export const TOOL_SOURCE_IDS = ["aic", "cma", "met", "smk", "mia", "rijks", "harvard"] as const;
export const VIEW_LIMIT = 8;
export const READ_LIMIT = 4;
const PREVIEW_ITEMS = 5;
/** A comment is one or two short sentences (the prompt asks for under 30
 *  words); past this it's cut at a sentence. */
const COMMENT_MAX = 220;

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
  /** works from earlier exhibits in the thread (validated records the browser
   *  sent back), so a follow-up can keep them even when their museum won't
   *  answer this server (AIC from datacenters, the Met under load) */
  known: Map<string, Artwork>;
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
  /** present_selection already sent back ids it couldn't load (once a turn) */
  missingReported?: boolean;
  /** the exhibit on the visitor's wall, if the wall is showing one: what
   *  revise_exhibit edits (its data-part id and current state) */
  wallExhibit?: { id: string; data: ExhibitData };
  /** this turn's edit to it, once revise_exhibit has run */
  revision?: RevisionData;
  revisionId?: string;
  /** searches run this turn */
  searches: number;
  /** the model's last word so far was prose, not a tool call: a turn that
   *  ends this way answered in the thread (set by the route's stream filter) */
  textAfterTool: boolean;
  /** the last data written for each step, to close any left running */
  steps: Map<string, StepData>;
  nextId: (prefix: string) => string;
}

export function createMuseumContext(
  writer: UIMessageStreamWriter<CurioUIMessage>,
  opts: { hosted: boolean; signal?: AbortSignal },
): MuseumContext {
  let n = 0;
  return {
    cache: new Map(),
    known: new Map(),
    steps: new Map(),
    viewed: new Set(),
    writer,
    signal: opts.signal,
    hosted: opts.hosted,
    pendingImages: [],
    searches: 0,
    textAfterTool: false,
    nextId: (prefix) => `${prefix}-${Date.now().toString(36)}-${++n}`,
  };
}

function writeStep(ctx: MuseumContext, id: string, data: StepData) {
  ctx.steps.set(id, data);
  ctx.writer.write({ type: "data-step", id, data });
}

/**
 * Close any step the turn left running (a tool the session gave up on, a
 * search cut off mid-flight), so the thread doesn't show it spinning forever
 * after the turn is over.
 */
export function closeOpenSteps(ctx: MuseumContext) {
  for (const [id, data] of ctx.steps) {
    if (data.phase !== "running") continue;
    writeStep(ctx, id, {
      ...data,
      phase: "error",
      endedAt: Date.now(),
      error: "didn't finish",
      items: data.items?.map((i) => (i.state === "loading" ? { ...i, state: "failed" as const } : i)),
    });
  }
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

/** An id to a full record: this turn's searches, then any recent search on
 *  this server, then the thread's earlier exhibits, then the museum itself. */
async function resolve(ctx: MuseumContext, id: string): Promise<Artwork | null> {
  const cached = ctx.cache.get(id);
  if (cached) return cached;
  const local = recentArtwork(id) ?? ctx.known.get(id);
  if (local) {
    ctx.cache.set(id, local);
    return local;
  }
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

export const readInput = z.object({
  ids: z
    .array(z.string())
    .describe("up to 4 artwork ids from search results, attachments or the wall"),
});

const commentsInput = z
  .array(
    z.object({
      id: z.string().describe("a work in the exhibit"),
      comment: z.string().describe("one or two short sentences (under 30 words) on this one work, leading with the point"),
    }),
  )
  .optional();

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
  comments: commentsInput.describe(
    "optional: a comment on each of the few works you want to point out specifically (usually 0-4 of them, never all by default)",
  ),
  followUps: z
    .array(z.string())
    .describe("2-3 short refinements the visitor might ask for next, e.g. 'warmer', 'only prints'"),
});

export const reviseInput = z.object({
  title: z.string().optional().describe("a new title, only if it should change"),
  note: z.string().optional().describe("a new exhibit note, only if it should change"),
  comments: commentsInput.describe(
    "comments to add or rewrite on works already in the exhibit; an empty comment removes that work's comment",
  ),
});

export const TOOL_DESCRIPTIONS = {
  search_artworks:
    "Search the museums' open-access collections (CC0 / public domain, with images). Returns compact rows: id, title, artist, date, source. No images: it can't tell you what anything looks like. Run a few variations before deciding.",
  view_artworks:
    "Look at the actual images of up to 8 works from your search results. Use it before choosing: you judge what you see, not titles.",
  read_about:
    "Read what the museums publish about up to 4 works: the museum's own label or catalogue text where it has one (the Art Institute of Chicago, Cleveland and Minneapolis often do; the Met never does), a few facts from the record, and a short note on each artist. Use it before you state history, stories, symbols or attributions.",
  present_selection:
    "Hang a new exhibit on the visitor's wall: the works you chose (usually 6-12, or exactly the number asked for, all ones you have looked at), a title, a short note in your own voice, optional comments on the few works you want to point out, and 2-3 follow-up suggestions. When you curate a new set, call it once, as the last thing you do in the turn.",
  revise_exhibit:
    "Edit the exhibit on the visitor's wall in place instead of hanging a new one: add, rewrite or remove comments on its works, or change its title or note. Use it when the visitor asks about or wants changes to what's already up and no works need to come or go.",
} as const;

/** Trim, collapse whitespace, and hold a comment to a few sentences. */
function cleanComment(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= COMMENT_MAX) return t;
  const cut = t.slice(0, COMMENT_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > COMMENT_MAX * 0.4 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Comments keyed by id, kept only for works in `ids` ("" kept when
 *  `allowEmpty`, meaning remove). Returns the ids that weren't in it. */
function commentMap(
  input: z.infer<typeof commentsInput>,
  ids: Set<string>,
  allowEmpty: boolean,
): { comments: Record<string, string>; stray: string[] } {
  const comments: Record<string, string> = {};
  const stray: string[] = [];
  for (const c of Array.isArray(input) ? input : []) {
    if (!c || typeof c.id !== "string") continue;
    if (!ids.has(c.id)) {
      stray.push(c.id);
      continue;
    }
    const text = cleanComment(String(c.comment ?? ""));
    if (text || allowEmpty) comments[c.id] = text;
  }
  return { comments, stray };
}

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
  ctx.searches++;
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

export async function readAboutWorks(
  args: z.infer<typeof readInput>,
  ctx: MuseumContext,
): Promise<string> {
  if (ctx.exhibit) return TURN_OVER;
  const id = ctx.nextId("step");
  const requested = Array.isArray(args.ids) ? args.ids : [];
  const ids = requested.slice(0, READ_LIMIT);
  const startedAt = Date.now();

  const works = await Promise.all(ids.map((wid) => resolve(ctx, wid)));
  const items: StepItem[] = works.map((a, i) =>
    a
      ? itemOf(a, "loading")
      : { id: ids[i], title: "Unknown work", artist: "", thumb: "", state: "failed" as const },
  );
  let found = 0;
  const write = (phase: StepData["phase"]) =>
    writeStep(ctx, id, {
      kind: "read",
      phase,
      startedAt,
      endedAt: phase === "running" ? undefined : Date.now(),
      count: ids.length,
      found,
      items: items.map((x) => ({ ...x })),
    });
  write("running");

  // "seen" here means the museum had its own text on the work; the rest
  // still get their artist note, but the thread shows them dimmed.
  const texts = await Promise.all(
    works.map(async (a, i) => {
      if (!a) return `${ids[i]}: not found`;
      const reading = await readAbout(a, ctx.signal);
      items[i].state = reading.label ? "seen" : "failed";
      if (reading.label) found++;
      write("running");
      return readingText(a, reading);
    }),
  );
  write("done");

  const capped =
    requested.length > READ_LIMIT ? `(capped to the first ${READ_LIMIT} of ${requested.length} requested ids)\n\n` : "";
  return `${capped}${texts.join("\n\n---\n\n")}\n\nWhen you lean on a museum's text, credit it in plain words, after the point rather than before it ("A fan print, the Minneapolis label notes, so..."). Never write about what a museum doesn't publish. Don't state what none of this, or your own eyes, supports.`;
}

export async function presentExhibit(
  args: z.infer<typeof exhibitInput>,
  ctx: MuseumContext,
): Promise<string> {
  const id = ctx.nextId("step");
  const startedAt = Date.now();
  const ids = Array.isArray(args.artworkIds) ? args.artworkIds : [];
  const found = await Promise.all(ids.map((wid) => resolve(ctx, wid)));
  // A work that can't be loaded would silently drop out while the note still
  // talks about it. The first time, hand it back so the model re-curates
  // with what it has; after that, curate whatever resolves.
  const missing = ids.filter((_, i) => !found[i]);
  if (missing.length > 0 && !ctx.exhibit && !ctx.missingReported) {
    ctx.missingReported = true;
    return `Couldn't load ${missing.join(", ")} (the museum didn't answer). Call present_selection again without ${
      missing.length === 1 ? "it" : "them"
    }, or with other works you have looked at, and write the note about the works that are actually in the exhibit.`;
  }
  writeStep(ctx, id, { kind: "exhibit", phase: "running", startedAt });
  const resolved = found.filter((a): a is Artwork => !!a);
  const { comments } = commentMap(args.comments, new Set(resolved.map((a) => a.id)), false);
  const exhibit: ExhibitData = {
    title: args.title?.trim() || "An exhibit",
    note: args.note?.trim() ?? "",
    artworks: resolved,
    followUps: (args.followUps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3),
    comments: Object.keys(comments).length ? comments : undefined,
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

export async function reviseExhibit(
  args: z.infer<typeof reviseInput>,
  ctx: MuseumContext,
): Promise<string> {
  if (ctx.exhibit) return TURN_OVER;
  const target = ctx.wallExhibit;
  if (!target) {
    return "There's no exhibit of yours on the visitor's wall to revise (it's showing a search, a collection, or nothing). Answer in the thread, or hang a new exhibit with present_selection.";
  }
  const works = new Map(target.data.artworks.map((a) => [a.id, a]));
  const { comments, stray } = commentMap(args.comments, new Set(works.keys()), true);
  const title = args.title?.trim();
  const note = args.note?.trim();
  const changed = Object.keys(comments).length > 0 || Boolean(title) || Boolean(note);
  if (!changed) {
    return stray.length
      ? `Nothing changed: ${stray.join(", ")} ${stray.length === 1 ? "isn't" : "aren't"} in the exhibit on the wall. Its works are: ${[...works.keys()].join(", ")}.`
      : "Nothing changed: give comments, a title or a note.";
  }

  // Apply to the running state, so a second call this turn builds on it.
  const nextComments = { ...target.data.comments };
  for (const [wid, text] of Object.entries(comments)) {
    if (text) nextComments[wid] = text;
    else delete nextComments[wid];
  }
  target.data = {
    ...target.data,
    title: title || target.data.title,
    note: note || target.data.note,
    comments: Object.keys(nextComments).length ? nextComments : undefined,
  };

  // The turn's whole edit, as one part rewritten in place.
  const prev = ctx.revision;
  const allComments = { ...prev?.comments, ...comments };
  ctx.revision = {
    target: target.id,
    title: target.data.title,
    retitled: Boolean(title) || prev?.retitled,
    note: note || prev?.note,
    comments: allComments,
    works: Object.keys(allComments).flatMap((wid) => {
      const a = works.get(wid);
      return a ? [itemOf(a, "seen")] : [];
    }),
  };
  ctx.revisionId ??= ctx.nextId("revision");
  const stepId = ctx.nextId("step");
  const now = Date.now();
  writeStep(ctx, stepId, { kind: "revise", phase: "done", startedAt: now, endedAt: now, count: Object.keys(comments).length });
  ctx.writer.write({ type: "data-revision", id: ctx.revisionId, data: ctx.revision });

  const set = Object.values(comments).filter(Boolean).length;
  const did = [
    set > 0 && `set comments on ${set} ${set === 1 ? "work" : "works"}`,
    Object.values(comments).some((c) => !c) && "removed a comment",
    title && "retitled it",
    note && "rewrote the note",
  ].filter(Boolean);
  const strayNote = stray.length ? ` Skipped ${stray.join(", ")}: not in the exhibit.` : "";
  return `Revised the exhibit on the wall: ${did.join(", ")}.${strayNote} The visitor sees the changes on the wall and in the thread. Add at most one short sentence in the thread, or nothing.`;
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
