import type OpenAI from "openai";
import { enabledSources, getArtworkById, searchSources } from "@/lib/adapters";
import type { Artwork, SourceId } from "@/lib/types";

export interface AgentStreamEvent {
  type: "text" | "status" | "selection" | "done" | "error";
  [key: string]: unknown;
}

export interface MuseumToolContext {
  /** full Artwork records stashed per search so present_selection can resolve ids */
  cache: Map<string, Artwork>;
  /** pushes an NDJSON event onto the route's response stream */
  emit: (event: AgentStreamEvent) => void;
  /** ids the model has actually seen a thumbnail for — feeds the hosted
   *  engine's safety-net selection when a turn ends without present_selection */
  viewed?: Set<string>;
}

/** What a tool call produced: text for the `tool` message, plus any images the
 *  model should look at (OpenAI-format tool messages are text-only, so the
 *  route forwards images in a follow-up user message). */
export interface ToolOutcome {
  text: string;
  images?: { data: string; mimeType: "image/png" | "image/jpeg" }[];
}

export const VIEW_LIMIT = 8;
/** guard against an oversized fetch (a non-IIIF thumb that turns out huge) */
const MAX_IMAGE_BYTES = 1_500_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) loupe/1.0";

/** AIC thumbs are IIIF (`/full/843,/0/default.jpg`) — rewrite the size segment
 * to a small bounding box so the curator isn't downloading full 843px images
 * eight at a time. Other sources have no IIIF sizing hook; fetched as-is,
 * guarded by MAX_IMAGE_BYTES. */
function viewUrl(artwork: Artwork): string {
  if (artwork.source === "aic") {
    return artwork.imageThumb.replace(/\/full\/[^/]+\//, "/full/!400,400/");
  }
  return artwork.imageThumb;
}

function mimeFromContentType(
  contentType: string | null,
  url: string,
): "image/png" | "image/jpeg" {
  if (contentType?.startsWith("image/png")) return "image/png";
  if (contentType?.startsWith("image/jpeg")) return "image/jpeg";
  return url.split("?")[0].toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";
}

export async function fetchThumbBase64(
  artwork: Artwork,
): Promise<{ data: string; mimeType: "image/png" | "image/jpeg" } | { error: string }> {
  const url = viewUrl(artwork);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": BROWSER_UA, accept: "image/*,*/*;q=0.8" },
    });
    if (!res.ok) return { error: `HTTP ${res.status} fetching thumbnail` };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { error: `thumbnail too large (${buffer.byteLength} bytes), skipped` };
    }
    return {
      data: buffer.toString("base64"),
      mimeType: mimeFromContentType(res.headers.get("content-type"), url),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "fetch failed" };
  }
}

/**
 * The curator's three tools in OpenAI function-calling format — works against
 * OpenRouter and any other OpenAI-compatible endpoint, no MCP, no subprocess.
 * Execution lives in runMuseumTool below; the route drives the loop.
 */
export const MUSEUM_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_artworks",
      description:
        "Search museum open-access APIs (CC0/public-domain, has-image only). Returns compact rows: id, title, artist, date, source. Run several variations before presenting.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "keyword query, e.g. 'nocturne', 'mist', 'still life'",
          },
          artist: { type: "string", description: "artist name, e.g. 'Monet'" },
          source: {
            type: "string",
            enum: ["aic", "cma", "met", "rijks"],
            description: "restrict to one museum; omit to search all",
          },
          yearFrom: { type: "number" },
          yearTo: { type: "number" },
          limit: { type: "number", description: "per-source, default 24" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_artworks",
      description:
        "Look at actual thumbnail images for up to 8 candidate artwork ids from your search results — use this before present_selection whenever composition matters (calm areas for UI, atmosphere, busyness). The images arrive in the next message, in the order listed.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: 'artwork ids ("source:nativeId") from search_artworks results',
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_selection",
      description:
        "Present a curated selection to the user's grid. Call exactly once at the end of every turn with 6-12 artwork ids from your search results and a short curatorial note.",
      parameters: {
        type: "object",
        properties: {
          artworkIds: {
            type: "array",
            items: { type: "string" },
            description: "ids from search_artworks results",
          },
          note: {
            type: "string",
            description: "one or two sentences on the selection's through-line",
          },
        },
        required: ["artworkIds", "note"],
      },
    },
  },
];

interface SearchArgs {
  q?: string;
  artist?: string;
  source?: SourceId;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
}

async function searchArtworks(args: SearchArgs, ctx: MuseumToolContext): Promise<ToolOutcome> {
  const sources: SourceId[] = args.source ? [args.source] : enabledSources();
  const { artworks, errors } = await searchSources(sources, {
    q: args.q,
    artist: args.artist,
    dateRange:
      args.yearFrom !== undefined && args.yearTo !== undefined
        ? [args.yearFrom, args.yearTo]
        : undefined,
    limit: args.limit,
  });
  for (const a of artworks) ctx.cache.set(a.id, a);
  const rows = artworks.map((a) => ({
    id: a.id,
    title: a.title,
    artist: a.artist,
    date: a.date,
    source: a.source,
  }));
  const errNote = errors.length
    ? ` (unavailable: ${errors.map((e) => e.source).join(", ")})`
    : "";
  return { text: `${rows.length} results${errNote}\n${JSON.stringify(rows)}` };
}

async function viewArtworks(
  args: { ids?: string[] },
  ctx: MuseumToolContext,
): Promise<ToolOutcome> {
  const requested = Array.isArray(args.ids) ? args.ids : [];
  const ids = requested.slice(0, VIEW_LIMIT);
  const lines: string[] = [];
  const images: NonNullable<ToolOutcome["images"]> = [];
  if (requested.length > VIEW_LIMIT) {
    lines.push(`capped to the first ${VIEW_LIMIT} of ${requested.length} requested ids`);
  }

  for (const id of ids) {
    let artwork = ctx.cache.get(id);
    if (!artwork) {
      const fetched = await getArtworkById(id).catch(() => null);
      if (fetched) {
        artwork = fetched;
        ctx.cache.set(fetched.id, fetched);
      }
    }
    if (!artwork) {
      lines.push(`${id}: not found (not from a search result this conversation)`);
      continue;
    }

    const thumb = await fetchThumbBase64(artwork);
    const label = `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date}`;
    if ("error" in thumb) {
      lines.push(`${label} — image unavailable: ${thumb.error}`);
      continue;
    }
    lines.push(`image ${images.length + 1}: ${label}`);
    images.push(thumb);
    ctx.viewed?.add(artwork.id);
  }

  return { text: lines.join("\n") || "nothing to view", images };
}

async function presentSelection(
  args: { artworkIds?: string[]; note?: string },
  ctx: MuseumToolContext,
): Promise<ToolOutcome> {
  const ids = Array.isArray(args.artworkIds) ? args.artworkIds : [];
  const resolved: Artwork[] = [];
  for (const id of ids) {
    const cached = ctx.cache.get(id);
    if (cached) {
      resolved.push(cached);
      continue;
    }
    // follow-up turns have a fresh cache — refetch by id
    const fetched = await getArtworkById(id).catch(() => null);
    if (fetched) resolved.push(fetched);
  }
  ctx.emit({ type: "selection", artworks: resolved, note: args.note ?? "" });
  return { text: `presented ${resolved.length} artworks to the user` };
}

/** Execute one curator tool call. */
export async function runMuseumTool(
  name: string,
  input: unknown,
  ctx: MuseumToolContext,
): Promise<ToolOutcome> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_artworks":
      return searchArtworks(args as SearchArgs, ctx);
    case "view_artworks":
      return viewArtworks(args as { ids?: string[] }, ctx);
    case "present_selection":
      return presentSelection(args as { artworkIds?: string[]; note?: string }, ctx);
    default:
      return { text: `unknown tool: ${name}` };
  }
}
