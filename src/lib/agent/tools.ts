import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

function mimeFromContentType(contentType: string | null, url: string): string {
  if (contentType?.startsWith("image/")) return contentType.split(";")[0].trim();
  return url.split("?")[0].toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";
}

async function fetchThumbBase64(
  artwork: Artwork,
): Promise<{ data: string; mimeType: string } | { error: string }> {
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
 * In-process MCP server exposing the curator's two tools. Created per request
 * so handlers close over the response stream controller.
 */
export function createMuseumServer(ctx: MuseumToolContext) {
  return createSdkMcpServer({
    name: "museum",
    version: "1.0.0",
    tools: [
      tool(
        "search_artworks",
        "Search museum open-access APIs (CC0/public-domain, has-image only). Returns compact rows: id, title, artist, date, source. Run several variations before presenting.",
        {
          q: z.string().optional().describe("keyword query, e.g. 'nocturne', 'mist', 'still life'"),
          artist: z.string().optional().describe("artist name, e.g. 'Monet'"),
          source: z
            .enum(["aic", "cma", "met", "rijks"])
            .optional()
            .describe("restrict to one museum; omit to search all"),
          yearFrom: z.number().optional(),
          yearTo: z.number().optional(),
          limit: z.number().optional().describe("per-source, default 24"),
        },
        async (args) => {
          const sources: SourceId[] = args.source
            ? [args.source]
            : enabledSources();
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
          return {
            content: [
              {
                type: "text" as const,
                text: `${rows.length} results${errNote}\n${JSON.stringify(rows)}`,
              },
            ],
          };
        },
      ),

      tool(
        "view_artworks",
        "Look at actual thumbnail images for up to 8 candidate artwork ids from your search results — use this before present_selection whenever composition matters (calm areas for UI, atmosphere, busyness). Returns each artwork's id/title/artist/date alongside its downsized image.",
        {
          ids: z
            .array(z.string())
            .describe("artwork ids (\"source:nativeId\") from search_artworks results"),
        },
        async (args): Promise<CallToolResult> => {
          const capped = args.ids.length > VIEW_LIMIT;
          const ids = args.ids.slice(0, VIEW_LIMIT);
          const content: CallToolResult["content"] = [];
          if (capped) {
            content.push({
              type: "text" as const,
              text: `capped to the first ${VIEW_LIMIT} of ${args.ids.length} requested ids`,
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
                type: "text" as const,
                text: `${id}: not found (not from a search result this conversation)`,
              });
              continue;
            }

            const thumb = await fetchThumbBase64(artwork);
            if ("error" in thumb) {
              content.push({
                type: "text" as const,
                text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date} — image unavailable: ${thumb.error}`,
              });
              continue;
            }

            content.push({
              type: "text" as const,
              text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date}`,
            });
            content.push({
              type: "image" as const,
              data: thumb.data,
              mimeType: thumb.mimeType,
            });
          }

          return { content };
        },
      ),

      tool(
        "present_selection",
        "Present a curated selection to the user's grid. Call exactly once at the end of every turn with 6-12 artwork ids from your search results and a short curatorial note.",
        {
          artworkIds: z.array(z.string()).describe("ids from search_artworks results"),
          note: z.string().describe("one or two sentences on the selection's through-line"),
        },
        async (args) => {
          const resolved: Artwork[] = [];
          for (const id of args.artworkIds) {
            const cached = ctx.cache.get(id);
            if (cached) {
              resolved.push(cached);
              continue;
            }
            // follow-up turns after resume have a fresh cache — refetch by id
            const fetched = await getArtworkById(id).catch(() => null);
            if (fetched) resolved.push(fetched);
          }
          ctx.emit({ type: "selection", artworks: resolved, note: args.note });
          return {
            content: [
              {
                type: "text" as const,
                text: `presented ${resolved.length} artworks to the user`,
              },
            ],
          };
        },
      ),
    ],
  });
}
