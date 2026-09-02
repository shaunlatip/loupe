import type Anthropic from "@anthropic-ai/sdk";
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
}

const VIEW_LIMIT = 8;
/** guard against an oversized fetch (a non-IIIF thumb that turns out huge) */
const MAX_IMAGE_BYTES = 1_500_000;
// AIC's IIIF server (and its /iiif/2 image derivatives) 403 bare Node fetches —
// same fix as export.ts, sent here too since we fetch thumbs server-side.
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

async function fetchThumbBase64(
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
 * The curator's three tools, as plain Anthropic Messages-API tool definitions —
 * no MCP, no subprocess, so this runs in a serverless function. Execution lives
 * in runMuseumTool below; the route drives the tool-use loop.
 */
export const MUSEUM_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_artworks",
    description:
      "Search museum open-access APIs (CC0/public-domain, has-image only). Returns compact rows: id, title, artist, date, source. Run several variations before presenting.",
    input_schema: {
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
  {
    name: "view_artworks",
    description:
      "Look at actual thumbnail images for up to 8 candidate artwork ids from your search results — use this before present_selection whenever composition matters (calm areas for UI, atmosphere, busyness). Returns each artwork's id/title/artist/date alongside its downsized image.",
    input_schema: {
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
  {
    name: "present_selection",
    description:
      "Present a curated selection to the user's grid. Call exactly once at the end of every turn with 6-12 artwork ids from your search results and a short curatorial note.",
    input_schema: {
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
];

/** tool_result content is text and image blocks — the model reads both. */
type ToolResultContent = Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

interface SearchArgs {
  q?: string;
  artist?: string;
  source?: SourceId;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
}

async function searchArtworks(
  args: SearchArgs,
  ctx: MuseumToolContext,
): Promise<ToolResultContent> {
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
  return [
    { type: "text", text: `${rows.length} results${errNote}\n${JSON.stringify(rows)}` },
  ];
}

async function viewArtworks(
  args: { ids?: string[] },
  ctx: MuseumToolContext,
): Promise<ToolResultContent> {
  const requested = Array.isArray(args.ids) ? args.ids : [];
  const capped = requested.length > VIEW_LIMIT;
  const ids = requested.slice(0, VIEW_LIMIT);
  const content: ToolResultContent = [];
  if (capped) {
    content.push({
      type: "text",
      text: `capped to the first ${VIEW_LIMIT} of ${requested.length} requested ids`,
    });
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
      content.push({
        type: "text",
        text: `${id}: not found (not from a search result this conversation)`,
      });
      continue;
    }

    const thumb = await fetchThumbBase64(artwork);
    if ("error" in thumb) {
      content.push({
        type: "text",
        text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date} — image unavailable: ${thumb.error}`,
      });
      continue;
    }

    content.push({
      type: "text",
      text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date}`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: thumb.mimeType, data: thumb.data },
    });
  }

  return content;
}

async function presentSelection(
  args: { artworkIds?: string[]; note?: string },
  ctx: MuseumToolContext,
): Promise<ToolResultContent> {
  const ids = Array.isArray(args.artworkIds) ? args.artworkIds : [];
  const resolved: Artwork[] = [];
  for (const id of ids) {
    const cached = ctx.cache.get(id);
    if (cached) {
      resolved.push(cached);
      continue;
    }
    // follow-up turns after resume have a fresh cache — refetch by id
    const fetched = await getArtworkById(id).catch(() => null);
    if (fetched) resolved.push(fetched);
  }
  ctx.emit({ type: "selection", artworks: resolved, note: args.note ?? "" });
  return [{ type: "text", text: `presented ${resolved.length} artworks to the user` }];
}

/** Execute one curator tool call and return its tool_result content blocks. */
export async function runMuseumTool(
  name: string,
  input: unknown,
  ctx: MuseumToolContext,
): Promise<ToolResultContent> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_artworks":
      return searchArtworks(args as SearchArgs, ctx);
    case "view_artworks":
      return viewArtworks(args as { ids?: string[] }, ctx);
    case "present_selection":
      return presentSelection(args as { artworkIds?: string[]; note?: string }, ctx);
    default:
      return [{ type: "text", text: `unknown tool: ${name}` }];
  }
}
